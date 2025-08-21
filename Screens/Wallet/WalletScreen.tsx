import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useTheme } from '../context/ThemeContext';
import { auth } from '../../firebaseConfig';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
// Icons
import { Ionicons } from '@expo/vector-icons';
import createStyles from '../context/appStyles';

type Tx = {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  note?: string;
  createdAt: number;
};

const functions = getFunctions(getApp(), 'us-central1');

export default function WalletScreen() {
  const { colors } = useTheme();

  const [balance, setBalance] = useState<number>(0);
  const [baseCurrency, setBaseCurrency] = useState<string>('ZAR');
  const [amount, setAmount] = useState<string>('50'); // default top-up
  const [loading, setLoading] = useState<boolean>(false);

  // history
  const [tx, setTx] = useState<Tx[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // QR receive modal
  const [qrVisible, setQrVisible] = useState<boolean>(false);
  const [qrAmount, setQrAmount] = useState<string>('');

  // Scanner modal
  const [scanVisible, setScanVisible] = useState<boolean>(false);
  const [sendVisible, setSendVisible] = useState<boolean>(false);
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [scanningLocked, setScanningLocked] = useState<boolean>(false);

  // Data from scanned QR
  const [scannedUid, setScannedUid] = useState<string>('');
  const [scannedCurrency, setScannedCurrency] = useState<string>('ZAR');
  const [scannedAmount, setScannedAmount] = useState<string>('');

  const uid = auth.currentUser?.uid || '';

  // --- Helpers ---------------------------------------------------------
  const styles = useMemo(() => createStyles(colors).WalletScreen, [colors]);
  const globalStyles = useMemo(() => createStyles(colors).global, [colors]);
  const createOrder = httpsCallable(functions, 'createPayPalOrder');
  const captureOrder = httpsCallable(functions, 'capturePayPalOrder');
  const getBalanceFn = httpsCallable(functions, 'getWalletBalance');
  const getTxFn = httpsCallable(functions, 'getTransactions');
  const transferFn = httpsCallable(functions, 'transferFunds');

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      const [bRes, tRes] = await Promise.all([getBalanceFn({}), getTxFn({ limit: 20 })]);
      const b = (bRes.data as any) || {};
      const t = (tRes.data as any) || {};
      setBalance(Number(b.balance || 0));
      setBaseCurrency((b.currency || 'ZAR').toUpperCase());
      setTx((t.items || []) as Tx[]);
      setHasMore(!!t.hasMore);
      setNextCursor(t.nextCursor || null);
    } catch (e: any) {
      console.log('wallet refresh err:', e?.message || e);
    }
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // FIX: safer formatter (handles undefined/NaN and bad currency)
  function formatMoney(v: unknown, ccy?: string) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v as any);
    const curr = (ccy && ccy.length === 3 ? ccy : 'USD').toUpperCase();

    if (!Number.isFinite(n)) return `${curr} 0.00`;

    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: curr,
        currencyDisplay: 'narrowSymbol',
      }).format(n);
    } catch {
      return `${curr} ${n.toFixed(2)}`;
    }
  }

  function buildQrPayload() {
    const payload = {
      type: 'wallet',
      uid,
      currency: baseCurrency,
      ...(qrAmount ? { amount: Number(qrAmount) } : {}),
      ts: Date.now(),
    };
    return JSON.stringify(payload);
  }

  // --- Top up via PayPal (uses your existing callable flow) -----------
  async function onTopUp() {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert('Invalid amount', 'Enter a valid number');
      return;
    }
    setLoading(true);
    try {
      const returnUrl = Linking.createURL('paypal-return');
      const cancelUrl = `${returnUrl}?cancel=true`;

      // 1) create
      const c = await createOrder({
        amount: Number(amount).toFixed(2),
        currency: baseCurrency,
        returnUrl,
        cancelUrl,
      });
      const d = (c.data || {}) as any;
      const approval =
        d?.approveLinks?.find((l: any) => l.rel === 'approve')?.href ||
        d?.links?.find((l: any) => l.rel === 'approve')?.href;
      if (!approval) {
        throw new Error('Missing PayPal approval URL');
      }

      // 2) open system browser session
      const res = await (await import('expo-web-browser')).openAuthSessionAsync(approval, returnUrl);
      if (res.type !== 'success') {
        if (res.type === 'cancel' || res.type === 'dismiss') return;
        throw new Error(`Browser: ${res.type}`);
      }

      // 3) capture
      const parsed = Linking.parse(res.url) as any;
      const token = parsed?.queryParams?.token || d?.orderId || parsed?.queryParams?.orderId;
      if (!token) throw new Error('No orderId from redirect');

      const cap = await captureOrder({ orderId: token });
      const capData = (cap.data || {}) as any;
      if (capData.status !== 'SUCCESS') {
        throw new Error(`Capture failed: ${capData.status || 'UNKNOWN'}`);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
      Alert.alert(
        'Top-up complete',
        `Credited ${formatMoney(capData.credited ?? Number(amount), baseCurrency)}`
      );
    } catch (e: any) {
      console.log('Top-up error:', e?.message || e);
      Alert.alert('Top-Up Failed', e?.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  }

  // --- History pagination ---------------------------------------------
  async function loadMore() {
    if (!hasMore || !nextCursor) return;
    try {
      const r = await getTxFn({ limit: 20, cursor: nextCursor });
      const d = (r.data || {}) as any;
      setTx((prev) => [...prev, ...(d.items || [])]);
      setHasMore(!!d.hasMore);
      setNextCursor(d.nextCursor || null);
    } catch (e) {
      console.log('loadMore err:', e);
    }
  }

  // --- QR: scan to send -----------------------------------------------
  function parseScannedData(data: string) {
    // Try JSON
    try {
      const obj = JSON.parse(data);
      if (obj && obj.uid) {
        return {
          uid: String(obj.uid),
          currency: (obj.currency || baseCurrency || 'ZAR').toUpperCase(),
          amount: obj.amount ? String(obj.amount) : '',
        };
      }
    } catch {}
    // Try dsquare://pay?to=UID&amount=123
    try {
      const parsed = Linking.parse(data) as any;
      const to = parsed?.queryParams?.to || parsed?.queryParams?.uid;
      const amt = parsed?.queryParams?.amount;
      if (to) {
        return {
          uid: String(to),
          currency: baseCurrency.toUpperCase(),
          amount: amt ? String(amt) : '',
        };
      }
    } catch {}
    // Fallback: treat entire string as UID
    return { uid: data, currency: baseCurrency.toUpperCase(), amount: '' };
  }

  const handleScanned = useCallback(
    (scan: any) => {
      if (scanningLocked) return;
      setScanningLocked(true);
      try {
        const code = Array.isArray(scan?.barcodes) ? scan.barcodes[0]?.data : scan?.data;
        if (!code) return;

        const parsed = parseScannedData(String(code));
        setScannedUid(parsed.uid);
        setScannedCurrency(parsed.currency);
        setScannedAmount(parsed.amount || '');
        setScanVisible(false);
        setTimeout(() => setSendVisible(true), 250);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } finally {
        setTimeout(() => setScanningLocked(false), 800);
      }
    },
    [scanningLocked, baseCurrency]
  );

  async function openScanner() {
    if (!cameraPerm?.granted) {
      const res = await requestCameraPerm();
      if (!res.granted) {
        Alert.alert('Camera needed', 'Enable camera access to scan QR codes.');
        return;
      }
    }
    setScanVisible(true);
  }

  async function onSendConfirm() {
    if (!scannedUid) {
      Alert.alert('No receiver', 'Scan a valid wallet QR code.');
      return;
    }
    if (!scannedAmount || isNaN(Number(scannedAmount))) {
      Alert.alert('Amount required', 'Enter a valid amount to send.');
      return;
    }
    setLoading(true);
    try {
      const r = await transferFn({
        toUid: scannedUid,
        amount: Number(scannedAmount).toFixed(2),
        currency: scannedCurrency || baseCurrency,
        note: 'QR payment',
      });
      const d = (r.data || {}) as any;
      if (d?.status !== 'SUCCESS') {
        throw new Error(d?.message || 'Transfer failed');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSendVisible(false);
      setScannedAmount('');
      await refresh();
      Alert.alert(
        'Sent',
        `You sent ${formatMoney(Number(d.debited ?? scannedAmount ?? 0), baseCurrency)}.`
      );
    } catch (e: any) {
      console.log('send err:', e?.message || e);
      Alert.alert('Send failed', e?.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  }

  // --- Render ----------------------------------------------------------
  const renderTx = ({ item }: { item: Tx }) => {
    const isDebit = item.type === 'debit';
    const sign = isDebit ? '-' : '+';
    const color = isDebit ? styles.txAmountNegative : styles.txAmountPositive;

    return (
      <View style={styles.txItem}>
        <View style={styles.txIconWrap}>
          {/* FIX: use valid Ionicons names */}
          <Ionicons
            name={isDebit ? 'trending-down' : 'trending-up'}
            size={18}
            color={isDebit ? colors.error : colors.success}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.txTitle}>{isDebit ? 'Sent' : 'Received'}</Text>
          {!!item.note && <Text style={styles.txMeta}>{item.note}</Text>}
          <Text style={styles.txMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
        </View>
        <Text style={[styles.txAmount, color]}>
          {sign}
          {formatMoney(item.amount, item.currency)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.screenTitle}>Wallet</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setQrVisible(true)} style={styles.iconBtn}>
            <Ionicons name="qr-code" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Balance card */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Available balance</Text>
        </View>
        <Text style={styles.balanceValue}>{formatMoney(balance, baseCurrency)}</Text>
        <Text style={styles.balanceSub}>{baseCurrency} Wallet • Secure payments</Text>

        {/* Your user id pill */}
        <View style={styles.idRow}>
          <View style={styles.idPill}>
            <Text style={styles.idPillText} numberOfLines={1}>
              {uid}
            </Text>
          </View>
        </View>
      </View>

      {/* Top up */}
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={80}
      >
        <View style={styles.topUpRow}>
          <TextInput
            style={styles.amountField}
            placeholder="Amount e.g. 50"
            placeholderTextColor={colors.placeholderText}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <TouchableOpacity onPress={onTopUp} disabled={loading} style={styles.topUpBtn}>
            <Ionicons name="card" size={18} color="#fff" />
            <Text style={styles.topUpBtnText}>{loading ? 'Processing…' : 'Top Up'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* History */}
      <Text style={styles.sectionTitle}>Recent activity</Text>
      <FlatList
        contentContainerStyle={styles.listPad}
        data={tx}
        keyExtractor={(i) => i.id}
        renderItem={renderTx}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No transactions yet</Text>}
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {/* Floating Scan button */}
      <TouchableOpacity style={styles.fab} onPress={openScanner} activeOpacity={0.8}>
        <Ionicons name="scan" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Receive QR modal */}
      <Modal visible={qrVisible} transparent animationType="slide">
        <Pressable style={styles.qrBackdrop} onPress={() => setQrVisible(false)}>
          <Pressable style={styles.qrSheet} onPress={() => {}}>
            <Text style={styles.qrTitle}>Receive money</Text>
            <Text style={styles.qrSubtitle}>Let the sender scan this code to pay you.</Text>

            <View style={styles.qrBlock}>
              <QRCode value={buildQrPayload()} size={180} />
            </View>

            <View style={styles.amountRow}>
              <Text style={styles.currencyPrefix}>{baseCurrency}</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="Optional amount"
                placeholderTextColor={colors.placeholderText}
                keyboardType="decimal-pad"
                value={qrAmount}
                onChangeText={setQrAmount}
              />
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={async () => {
                  await Clipboard.setStringAsync(uid);
                  Haptics.selectionAsync();
                }}
              >
                <Ionicons name="copy" size={16} color={colors.textPrimary} />
                <Text style={styles.copyBtnText}>Copy ID</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.qrActions}>
              <TouchableOpacity
                style={styles.qrShareBtn}
                onPress={async () => {
                  const payload = buildQrPayload();
                  await Clipboard.setStringAsync(payload);
                  Alert.alert('Copied', 'QR payload copied to clipboard.');
                }}
              >
                <Ionicons name="share-social" size={18} color="#fff" />
                <Text style={styles.qrShareText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.qrCloseBtn} onPress={() => setQrVisible(false)}>
                <Text style={styles.qrCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Scanner modal */}
      <Modal visible={scanVisible} transparent animationType="fade">
        <View style={styles.scannerModal}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleScanned}
          />
          <View style={styles.scanOverlay}>
            <Text style={styles.scanHint}>Align the QR within the frame</Text>
            <TouchableOpacity onPress={() => setScanVisible(false)} style={styles.qrCloseBtn}>
              <Text style={styles.qrCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Send confirm modal (after scan) */}
      <Modal visible={sendVisible} transparent animationType="slide">
        <Pressable style={styles.qrBackdrop} onPress={() => setSendVisible(false)}>
          <Pressable style={styles.sendModalCard} onPress={() => {}}>
            <Text style={styles.qrTitle}>Send money</Text>
            <Text style={styles.qrSubtitle}>To: {scannedUid}</Text>

            <View style={styles.amountRow}>
              <Text style={styles.currencyPrefix}>{scannedCurrency}</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="Amount"
                placeholderTextColor={colors.placeholderText}
                keyboardType="decimal-pad"
                value={scannedAmount}
                onChangeText={setScannedAmount}
              />
            </View>

            <View style={styles.sendActions}>
              <TouchableOpacity onPress={() => setSendVisible(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onSendConfirm} style={styles.sendBtn} disabled={loading}>
                <Text style={styles.sendBtnText}>{loading ? 'Sending…' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}


