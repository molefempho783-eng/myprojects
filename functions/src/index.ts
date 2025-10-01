// functions/src/index.ts

import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import corsLib from 'cors';
import express from 'express';
import bodyParser from 'body-parser';

import { onDocumentUpdated, onDocumentCreated  } from 'firebase-functions/v2/firestore';


// ---------- App currency & PayPal ----------
const APP_DEFAULT_CCY = 'ZAR';
const getBaseCurrency = (): string =>
  (process.env.APP_BASE_CURRENCY || APP_DEFAULT_CCY).toUpperCase();

const PAYPAL_ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const PAYPAL_API_BASE =
  PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

const PAYPAL_SUPPORTED = new Set([
  'AUD','BRL','CAD','CNY','CZK','DKK','EUR','HKD','HUF','ILS','JPY','MYR',
  'MXN','TWD','NZD','NOK','PHP','PLN','GBP','SGD','SEK','CHF','THB','USD'
]);
const PAYPAL_FALLBACK_CCY = 'USD';

// ---------- Admin init ----------
if (getApps().length === 0) initializeApp();
const db = getFirestore();

// ---------- Helpers ----------
const cors = corsLib({ origin: true });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpsError('failed-precondition', `Missing secret: ${name}`);
  return v;
}
function uidOrThrow(req: { auth?: { uid?: string } }): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Not signed in.');
  return uid;
}
async function getPayPalAccessToken(): Promise<string> {
  const client = requireEnv('PAYPAL_CLIENT_ID');
  const secret = requireEnv('PAYPAL_SECRET');
  const creds = Buffer.from(`${client}:${secret}`).toString('base64');

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error('PayPal token error', text);
    throw new HttpsError('internal', `PayPal token error: ${text}`);
  }
  const data: any = await res.json();
  return data.access_token;
}

function previewFromMessage(msg: any): string {
  if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text.trim().slice(0, 140);
  if (msg?.mediaType === 'image') return 'Image 📸';
  if (msg?.mediaType === 'video') return 'Video 🎥';
  if (msg?.mediaType === 'file')  return `File 📄${msg?.fileName ? `: ${String(msg.fileName)}` : ''}`;
  return 'New message';
}

//-------------push notification ---------------

const EXPO_PROJECT_ID = process.env.expo_project_id ||'8b40b37d-0d36-40b5-a1e8-c2a55308ab7e'; // set this!

async function sendExpoPush(
  to: string[] | string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (list.length === 0) return;

  for (let i = 0; i < list.length; i += 99) {
    const chunk = list.slice(i, i + 99);

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(EXPO_PROJECT_ID ? { 'expo-project-id': EXPO_PROJECT_ID } : {}),
      },
      body: JSON.stringify(
        chunk.map((t) => ({
          to: t,
          sound: 'default',
          title,
          body,
          data,
        }))
      ),
    });

    const text = await res.text();

    if (!res.ok) {
      logger.error('Expo push HTTP error', { status: res.status, body: text.slice(0, 500) });
      continue;
    }

    // Parse tickets and log per-ticket errors
    try {
      const json = JSON.parse(text);
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const tk of tickets) {
        if (tk?.status !== 'ok') {
          logger.warn('Expo ticket error', tk);
          // Optional: if tk.details?.error === 'DeviceNotRegistered', remove the token.
          // await removeBadTokenFromAllUsers(tk?.details?.expoPushToken);
        }
      }
    } catch (e: any) {
      logger.warn('Expo push response parse failed', { error: String(e), body: text.slice(0, 500) });
    }
  }
}


// ---------- FX Conversion with robust fallback ----------
async function fxConvert(amount: number, from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return Number(amount);

  const _from = from.toUpperCase();
  const _to = to.toUpperCase();
  const aStr = String(amount);
  const fxKey = (process.env.FX_API_KEY || '').trim();

  const getJson = async (url: string, headers: Record<string,string> = {}) => {
    const res = await fetch(url, { headers });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return { ok: res.ok, json, text };
    } catch {
      return { ok: res.ok, json: null as any, text };
    }
  };

  // 1) Preferred: exchangerate-api.com (requires a valid FX_API_KEY)
  if (fxKey) {
    try {
      const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(fxKey)}/pair/${_from}/${_to}/${encodeURIComponent(aStr)}`;
      const { ok, json, text } = await getJson(url);
      if (ok) {
        const result = json?.conversion_result ?? json?.result ?? null;
        if (typeof result === 'number') return result;
        // explicit API error? fall through to frankfurter
        logger.warn('FX v6 payload not numeric, falling back', text.slice(0, 300));
      } else {
        // known error types: invalid-key, inactive-account, function_access_restricted
        logger.warn('FX v6 HTTP error, falling back', text.slice(0, 300));
      }
    } catch (e:any) {
      logger.warn('FX v6 threw, falling back', e?.message || e);
    }
  }

  // 2) Frankfurter (ECB) – no key required
  try {
    const url = `https://api.frankfurter.app/latest?amount=${encodeURIComponent(aStr)}&from=${_from}&to=${_to}`;
    const { ok, json, text } = await getJson(url);
    if (!ok) throw new Error(`HTTP ${text.slice(0,200)}`);
    const val = json?.rates?.[_to];
    if (typeof val === 'number') return val;
    throw new Error(`Bad payload ${text.slice(0,200)}`);
  } catch (e:any) {
    logger.warn('FX frankfurter failed, falling back to exchangerate.host', e?.message || e);
  }

  // 3) Last resort: exchangerate.host (may require key on some deployments)
  {
    const url = `https://api.exchangerate.host/convert?from=${_from}&to=${_to}&amount=${encodeURIComponent(aStr)}`;
    const { ok, json, text } = await getJson(url);
    if (!ok) throw new HttpsError('internal', `FX HTTP error: ${text.slice(0,200)}`);
    const success = json?.success ?? true;
    const result = json?.result ?? json?.conversion_result ?? null;
    if (!success || typeof result !== 'number') {
      throw new HttpsError('internal', `FX (exchangerate.host) bad payload: ${text.slice(0,300)}`);
    }
    return result;
  }
}

function walletDoc(uid: string) { return db.collection('wallets').doc(uid); }
function txCollection(uid: string) { return walletDoc(uid).collection('transactions'); }

// ---------- Types ----------
// add returnUrl / cancelUrl (optional)
type CreateOrderPayload = {
  amount: string;
  currency: string;
  intent?: 'CAPTURE' | 'AUTHORIZE';
  description?: string;
  returnUrl?: string;  // 👈 add
  cancelUrl?: string;  // 👈 add
};
type CaptureOrderPayload = { orderId: string };
type P2PTransferPayload  = { toUid: string; amount: number; note?: string };
type TransactionsPayload = { limit?: number; cursor?: string };
type ConvertPayload      = { amount: number; from: string; to?: string };

// ---------- 1) Create PayPal Order ----------
export const createPayPalOrder = onCall(
  { secrets: ['PAYPAL_CLIENT_ID','PAYPAL_SECRET','FX_API_KEY'] },
  async (request) => {
    const uid = uidOrThrow(request);
    const data = request.data as CreateOrderPayload;

    const amountStr = data.amount;
    const inputCurrency = (data.currency || getBaseCurrency()).toUpperCase();
    const intent = data.intent ?? 'CAPTURE';
    const description = data.description ?? 'Wallet top-up';

    if (!amountStr || isNaN(Number(amountStr))) {
      throw new HttpsError('invalid-argument', 'amount must be a stringified number');
    }

    // currency fallback/convert if needed ...
    let orderCurrency = inputCurrency;
    let orderAmountStr = amountStr;
    if (!PAYPAL_SUPPORTED.has(orderCurrency)) {
      const converted = await fxConvert(Number(amountStr), inputCurrency, PAYPAL_FALLBACK_CCY);
      orderCurrency = PAYPAL_FALLBACK_CCY;
      orderAmountStr = converted.toFixed(2);
    }

    // ✅ make sure you pass these from the client (e.g. dsquare://paypal-return)
    const returnUrl = data.returnUrl;
    const cancelUrl = data.cancelUrl;

    const accessToken = await getPayPalAccessToken();

    const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent,
        purchase_units: [{
          amount: { currency_code: orderCurrency, value: orderAmountStr },
          description,
          custom_id: uid,
        }],
        // 👇 THIS is the part you asked about
        application_context: {
          brand_name: 'Dsquare',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: returnUrl,  // e.g. dsquare://paypal-return
          cancel_url: cancelUrl,
        },
      }),
    });

    const body: any = await res.json();
    if (!res.ok) {
      throw new HttpsError('internal', `PayPal create error: ${JSON.stringify(body)}`);
    }

    return {
      orderId: body.id,
      status: body.status,
      approveLinks: (body.links || []).filter((l: any) => l.rel === 'approve'),
      orderCurrency,
      originalCurrency: inputCurrency,
      originalAmount: amountStr,
      orderAmount: orderAmountStr,
    };
  }
);




// ---------- 2) Capture PayPal Order & credit wallet ----------
// ---------- 2) Capture PayPal Order & credit wallet ----------
export const capturePayPalOrder = onCall(
  { secrets: ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET'] },
  async (request) => {
    const uid = uidOrThrow(request);
    const { orderId } = request.data as { orderId: string };
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId required');

    const accessToken = await getPayPalAccessToken();

    // PayPal wants JSON headers, even with an empty body
    const capRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation', // optional but useful
      },
      body: JSON.stringify({}), // <- important
    });

    const capBody: any = await capRes.json().catch(async () => ({ raw: await capRes.text() }));
    if (!capRes.ok) {
      // surface PayPal debug info to logs
      logger.error('PayPal capture error', { status: capRes.status, capBody });
      throw new HttpsError('internal', `PayPal capture error: ${JSON.stringify(capBody)}`);
    }

    const status = capBody.status;
    if (status !== 'COMPLETED') {
      throw new HttpsError('failed-precondition', `Order not completed: ${status}`);
    }

    const pu = capBody.purchase_units?.[0];
    const capture = pu?.payments?.captures?.[0];

    if (!capture?.amount?.value || !capture?.amount?.currency_code) {
      throw new HttpsError('internal', 'Missing capture amount');
    }

    const grossStr: string = capture.amount.value;
    const grossCurrency: string = String(capture.amount.currency_code).toUpperCase();
    const gross = Number(grossStr);

    // credit in your base currency (whatever your create function used)
    const base = getBaseCurrency();
    const credit = grossCurrency === base ? gross : await fxConvert(gross, grossCurrency, base);

    const now = Timestamp.now();
    const txId = capture.id || orderId;

    await db.runTransaction(async (t) => {
      const wRef = walletDoc(uid);
      const wSnap = await t.get(wRef);
      const prevBalance = wSnap.exists ? Number(wSnap.get('balance') || 0) : 0;

      t.set(
        wRef,
        {
          uid,
          balance: prevBalance + credit,
          currency: base,
          updatedAt: now,
          createdAt: wSnap.exists ? (wSnap.get('createdAt') || now) : now,
        },
        { merge: true }
      );

      const txRef = txCollection(uid).doc(txId);
      t.set(txRef, {
        type: 'TOP_UP',
        provider: 'PAYPAL',
        orderId,
        captureId: capture.id || null,
        grossAmount: gross,
        grossCurrency,
        creditAmount: credit,
        creditCurrency: base,
        status: 'SUCCESS',
        createdAt: now,
      });
    });

    return {
      status: 'SUCCESS',
      credited: Number(credit.toFixed(2)),
      currency: base,
      paypal: { id: capture.id, orderId },
    };
  }
);


// ---------- 3) Currency conversion utility ----------
export const convertCurrency = onCall(
  { secrets: ['FX_API_KEY'] },
  async (request) => {
    const { amount, from, to: _to } = request.data as ConvertPayload;
    const to = (_to || getBaseCurrency()).toUpperCase();
    if (amount == null || isNaN(Number(amount))) throw new HttpsError('invalid-argument', 'Invalid amount');
    if (!from) throw new HttpsError('invalid-argument', 'from currency required');

    const result = await fxConvert(Number(amount), String(from).toUpperCase(), to);
    return { amount: Number(result.toFixed(2)), currency: to };
  }
);

// ---------- 4) P2P transfer ----------
export const transferFunds = onCall({}, async (request) => {
  const fromUid = uidOrThrow(request);
  const { toUid, amount, note } = request.data as P2PTransferPayload;

  if (!toUid || typeof toUid !== 'string') throw new HttpsError('invalid-argument', 'toUid required');
  if (toUid === fromUid) throw new HttpsError('invalid-argument', 'Cannot send to yourself');
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be > 0');
  }

  const amt  = Number(amount);
  const now  = Timestamp.now();
  const base = getBaseCurrency();

  await db.runTransaction(async (t) => {
    const fromRef = walletDoc(fromUid);
    const toRef   = walletDoc(toUid);
    const [fromSnap, toSnap] = await Promise.all([t.get(fromRef), t.get(toRef)]);

    const fromBal = fromSnap.exists ? Number(fromSnap.get('balance') || 0) : 0;
    if (fromBal < amt) throw new HttpsError('failed-precondition', 'Insufficient balance');

    t.set(fromRef, {
      uid: fromUid,
      balance: fromBal - amt,
      currency: base,
      updatedAt: now,
      createdAt: fromSnap.exists ? (fromSnap.get('createdAt') || now) : now,
    }, { merge: true });

    const toBal = toSnap.exists ? Number(toSnap.get('balance') || 0) : 0;
    t.set(toRef, {
      uid: toUid,
      balance: toBal + amt,
      currency: base,
      updatedAt: now,
      createdAt: toSnap.exists ? (toSnap.get('createdAt') || now) : now,
    }, { merge: true });

    const debitId  = db.collection('_ids').doc().id;
    const creditId = db.collection('_ids').doc().id;

    t.set(txCollection(fromUid).doc(debitId), {
      type: 'TRANSFER_OUT',
      counterparty: toUid,
      amount: amt,
      currency: base,
      note: note || null,
      createdAt: now,
      status: 'SUCCESS',
    });

    t.set(txCollection(toUid).doc(creditId), {
      type: 'TRANSFER_IN',
      counterparty: fromUid,
      amount: amt,
      currency: base,
      note: note || null,
      createdAt: now,
      status: 'SUCCESS',
    });
  });

  return { status: 'SUCCESS' };
});

// ---------- 5) Transactions ----------
export const getTransactions = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const data = request.data as TransactionsPayload;
  const limit = Math.max(1, Math.min(50, Number(data.limit ?? 20)));

  let q = txCollection(uid).orderBy('createdAt', 'desc').limit(limit);
  if (data.cursor) {
    const cursorSnap = await txCollection(uid).doc(data.cursor).get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap);
  }

  const snaps = await q.get();
  const items = snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
  const nextCursor = snaps.size === limit ? snaps.docs[snaps.docs.length - 1].id : null;
  return { items, nextCursor };
});

// ---------- 6) Wallet balance ----------
export const getWalletBalance = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const snap = await walletDoc(uid).get();
  if (!snap.exists) return { balance: 0, currency: getBaseCurrency() };
  const balance = Number(snap.get('balance') || 0);
  const currency = String(snap.get('currency') || getBaseCurrency()).toUpperCase();
  return { balance, currency };
});

// ---------- 7) Admin adjust ----------
export const adminAdjustBalance = onCall({}, async (request) => {
  const caller = uidOrThrow(request);
  const token = await getAuth().getUser(caller);
  const isAdmin = !!(token.customClaims && (token.customClaims as any).admin === true);
  if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only');

  const { uid, delta, reason } = request.data as { uid: string; delta: number; reason?: string };
  if (!uid || typeof uid !== 'string') throw new HttpsError('invalid-argument', 'uid required');
  if (delta == null || isNaN(Number(delta))) throw new HttpsError('invalid-argument', 'delta must be a number');

  const now  = Timestamp.now();
  const base = getBaseCurrency();

  await db.runTransaction(async (t) => {
    const wRef = walletDoc(uid);
    const wSnap = await t.get(wRef);
    const bal = wSnap.exists ? Number(wSnap.get('balance') || 0) : 0;

    t.set(wRef, {
      uid,
      balance: bal + Number(delta),
      currency: base,
      updatedAt: now,
      createdAt: wSnap.exists ? (wSnap.get('createdAt') || now) : now,
    }, { merge: true });

    const txId = db.collection('_ids').doc().id;
    t.set(txCollection(uid).doc(txId), {
      type: 'ADMIN_ADJUST',
      amount: Number(delta),
      currency: base,
      reason: reason || null,
      createdAt: now,
      status: 'SUCCESS',
      adminUid: caller,
    });
  });

  return { status: 'SUCCESS' };
});

// ---------- 8) Express webhook ----------
const app = express();
app.use(bodyParser.json());
app.use((req, res, next) => cors(req, res, next));

app.post('/paypal/webhook', async (req, res) => {
  try {
    const webhookId = requireEnv('PAYPAL_WEBHOOK_ID');

    const transmissionId = req.header('Paypal-Transmission-Id');
    const transmissionTime = req.header('Paypal-Transmission-Time');
    const certUrl = req.header('Paypal-Cert-Url');
    const authAlgo = req.header('Paypal-Auth-Algo');
    const transmissionSig = req.header('Paypal-Transmission-Sig');
    const body = req.body;

    const accessToken = await getPayPalAccessToken();
    const verifyRes = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_id: webhookId,
        webhook_event: body,
      }),
    });

    const verifyJson: any = await verifyRes.json();
    if (verifyJson.verification_status !== 'SUCCESS') {
      logger.warn('Webhook verification failed', verifyJson);
      return res.status(400).json({ ok: false, reason: 'verification_failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    logger.error('Webhook error', e);
    return res.status(500).json({ ok: false, error: e?.message || 'server_error' });
  }
});

export const api = onRequest(
  { secrets: ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_WEBHOOK_ID', 'FX_API_KEY'] },
  app
);

// ---------- 9) Complete ride and pay driver (atomic) ----------
export const payDriverOnComplete = onCall({}, async (request) => {
  const riderUid = uidOrThrow(request);
  const { rideId } = request.data as { rideId: string };
  if (!rideId || typeof rideId !== "string") {
    throw new HttpsError("invalid-argument", "rideId required");
  }

  const rideRef = db.collection("rides").doc(rideId);

  // Optional env fee, default 20%
  const feeRateEnv = Number(process.env.APP_PLATFORM_FEE_RATE || "0.20");
  const feeRate = Number.isFinite(feeRateEnv) ? Math.max(0, Math.min(0.95, feeRateEnv)) : 0.20;

  await db.runTransaction(async (t) => {
    const now = Timestamp.now();

    const rideSnap = await t.get(rideRef);
    if (!rideSnap.exists) throw new HttpsError("not-found", "Ride not found.");
    const ride = rideSnap.data() as any;

    // Idempotency: if already paid/completed, return early
    if (ride?.payment?.status === "authorized" || ride?.status === "completed") {
      // also ensure driver is freed
      if (ride?.driver?.id) {
        t.set(db.collection("drivers_live").doc(ride.driver.id), { occupied: false, updatedAt: now }, { merge: true });
      }
      return;
    }

    // Authorization & state checks
    if (ride.userId !== riderUid) throw new HttpsError("permission-denied", "Not your ride.");
    if (ride.status !== "on_trip") {
      throw new HttpsError("failed-precondition", `Ride must be on_trip to complete (current: ${ride.status}).`);
    }

    const driverId = ride?.driver?.id;
    if (!driverId) throw new HttpsError("failed-precondition", "No assigned driver.");

    const amount = Number(ride.estimatedFareZAR || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("failed-precondition", "Invalid fare amount.");
    }

    // Wallets
    const riderWalletRef  = walletDoc(riderUid);
    const driverWalletRef = walletDoc(driverId);

    const [riderW, driverW] = await Promise.all([t.get(riderWalletRef), t.get(driverWalletRef)]);
    const base = getBaseCurrency();

    const riderBal = riderW.exists ? Number(riderW.get("balance") || 0) : 0;
    if (riderBal < amount) throw new HttpsError("failed-precondition", "Insufficient rider balance.");

    const driverBal = driverW.exists ? Number(driverW.get("balance") || 0) : 0;

    // Split & round to whole cents (or rands if you store whole units)
    const platformFee = Math.round(amount * feeRate);
    const payout = amount - platformFee;

    // Debit rider, credit driver
    t.set(
      riderWalletRef,
      {
        uid: riderUid,
        balance: riderBal - amount,
        currency: base,
        updatedAt: now,
        createdAt: riderW.exists ? (riderW.get("createdAt") || now) : now,
      },
      { merge: true }
    );

    t.set(
      driverWalletRef,
      {
        uid: driverId,
        balance: driverBal + payout,
        currency: base,
        updatedAt: now,
        createdAt: driverW.exists ? (driverW.get("createdAt") || now) : now,
      },
      { merge: true }
    );

    // Transactions (two-sided ledger)
    const debitId  = db.collection("_ids").doc().id;
    const creditId = db.collection("_ids").doc().id;

    t.set(txCollection(riderUid).doc(debitId), {
      type: "RIDE_PAYMENT",
      rideId,
      counterparty: driverId,
      amount: amount,
      currency: base,
      platformFee,
      payoutToDriver: payout,
      createdAt: now,
      status: "SUCCESS",
    });

    t.set(txCollection(driverId).doc(creditId), {
      type: "RIDE_EARN",
      rideId,
      counterparty: riderUid,
      amount: payout,
      currency: base,
      platformFee, // for reporting
      createdAt: now,
      status: "SUCCESS",
    });

    // Mark ride completed & paid
    t.update(rideRef, {
      status: "completed",
      payment: { status: "authorized", lastError: null },
      updatedAt: now,
    });

    // Free the driver for new jobs
    t.set(db.collection("drivers_live").doc(driverId), { occupied: false, updatedAt: now }, { merge: true });
  });

  return { ok: true };
});

// ---------- 10) Complete order and pay  (atomic) ----------

export const payAndPlaceOrder = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const { businessId, items, address, total } = req.data || {};
  if (!businessId || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "Missing order fields.");
  }

  const orderRef    = db.collection("orders").doc();
  const buyerRef    = db.doc(`wallets/${uid}`);
  const businessRef = db.doc(`businesses/${businessId}`);

  // 👇 hoist for use after transaction (push notification)
  let ownerId: string = "";

  await db.runTransaction(async (tx) => {
    // Load business and read ownerId server-side
    const bizSnap = await tx.get(businessRef);
    if (!bizSnap.exists) throw new HttpsError("not-found", "Business not found.");

    ownerId = String(bizSnap.get("ownerId") || "");
    if (!ownerId) throw new HttpsError("failed-precondition", "Business owner not set.");

    const sellerRef = db.doc(`wallets/${ownerId}`);

    // Check buyer balance
    const buyerSnap = await tx.get(buyerRef);
    const buyerBal  = buyerSnap.exists ? Number(buyerSnap.get("balance") || 0) : 0;
    const amount    = Number(total);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("invalid-argument", "Invalid total.");
    }
    if (!Number.isFinite(buyerBal)) {
      throw new HttpsError("failed-precondition", "Bad wallet state.");
    }
    if (buyerBal < amount) {
      throw new HttpsError("failed-precondition", "Insufficient funds.");
    }

    const now = FieldValue.serverTimestamp();

    // Atomic debit/credit with timestamps
    tx.set(buyerRef,  { uid, balance: FieldValue.increment(-amount), updatedAt: now }, { merge: true });
    tx.set(sellerRef, { uid: ownerId, balance: FieldValue.increment(+amount), updatedAt: now }, { merge: true });

    // Create paid order
    tx.set(orderRef, {
      businessId,
      ownerId,
      userId: uid,
      items,
      subtotal: amount,
      total: amount,
      deliveryAddress: address || null,
      status: "paid",
      createdAt: now,
      updatedAt: now,
    });

    // (Optional) validate/decrement stock here in the same tx
  });

  // Push to business owner after funds moved & order created
  try {
    if (ownerId) {
      const ownerSnap = await db.collection('users').doc(ownerId).get();
      const tokens = (ownerSnap.get('expoPushTokens') || []) as string[];
      const valid = tokens.filter(t => typeof t === 'string' && t.startsWith('ExponentPushToken'));
      if (valid.length) {
        await sendExpoPush(valid, 'New order', `R${Number(total).toFixed(2)} from a customer`, {
          businessId,
          orderId: orderRef.id,
        });
      }
    }
  } catch (e) {
    logger.warn('Push to owner failed', e);
  }

  return { orderId: orderRef.id, status: "paid" };
});

//----------(10) Status change → notify buyer --------------
export const notifyBuyerOrderStatus = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before: any = event.data?.before?.data();
  const after:  any = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status === after.status) return;

  const userId = after.userId;
  if (!userId) return;

  const user = await db.collection('users').doc(userId).get();
  const tokens: string[] = (user.get('expoPushTokens') || []).filter((t: any) =>
    typeof t === 'string' && t.startsWith('ExponentPushToken')
  );
  if (tokens.length) {
    await sendExpoPush(tokens, 'Order update', `Your order is now ${String(after.status)}`, {
      orderId: event.params.orderId,
      status: after.status,
    });
  }
});

// ---------- [MODIFIED] Notify on new DM message & maintain chat meta ----------
export const notifyOnNewDM = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const chatId = event.params.chatId;
  const msg = event.data?.data();
  if (!msg) return;

  const senderId = String(msg.senderId || '');
  if (!senderId) return;

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return;

    const chat = chatSnap.data() || {};

    // Figure out the two participants and the recipient
    let participants: string[] = [];
    if (Array.isArray(chat.participants)) {
      participants = chat.participants.filter((x: any) => typeof x === 'string');
    } else if (chat.participants && typeof chat.participants === 'object') {
      participants = Object.keys(chat.participants).filter((k) => chat.participants[k] === true);
    }

    // This trigger is for 1-on-1 direct messages only
    if (participants.length !== 2) return;

    const recipientId = participants.find((p) => p !== senderId);
    if (!recipientId) return;

    // Update chat meta: last message + unread flags
    const lastMessageText = previewFromMessage(msg);
    await chatRef.set(
      {
        lastMessageText,
        lastMessageSenderId: senderId,
        lastMessageTimestamp: FieldValue.serverTimestamp(),
        unreadFor: {
          [recipientId]: true,
          [senderId]: false,
        },
      },
      { merge: true }
    );

    // Fetch sender's name for the title and recipient's tokens for sending
    const senderSnap = await db.collection('users').doc(senderId).get();
    const recipientSnap = await db.collection('users').doc(recipientId).get();

    const tokens: string[] = (recipientSnap.get('expoPushTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
    );

    if (!tokens.length) return;

    // Use sender's name for the notification title
    const title = senderSnap.get('username') ? String(senderSnap.get('username')) : 'New message';
    const body  = lastMessageText;

    // Include navigation hints in data payload for your app
    // When the recipient taps, they need to open a chat with the SENDER.
    // So the navigation `recipientId` param should be the sender's ID.
    await sendExpoPush(tokens, title, body, {
      type: 'dm',
      chatId,
      recipientId: senderId,
    });
  } catch (e) {
    logger.warn('notifyOnNewDM failed', e);
  }
});
