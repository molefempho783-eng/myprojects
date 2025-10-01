// Screens/Users/UsersScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Image,
  Alert,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../types";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  where,
  query,
  DocumentData,
} from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { Ionicons } from "@expo/vector-icons";

const DEFAULT_AVATAR = require("../../assets/avatar-placeholder.png");

type NavigationProp = StackNavigationProp<RootStackParamList, "ChatRoomScreen">;

type UserRow = {
  id: string;
  username: string;
  profilePic?: string;
  aboutMe?: string;
};

type ChatDoc = {
  participants: string[];
  unreadFor?: Record<string, boolean>;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageTimestamp?: any;
};

const UsersScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const styles = createStyles(colors).communityScreen;
  const globalStyles = createStyles(colors).global;

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // unread lookup by the *other* user's id
  const [unreadByUser, setUnreadByUser] = useState<Record<string, boolean>>({});
  // (optional) last message preview per other user
  const [previewByUser, setPreviewByUser] = useState<
    Record<string, { text?: string; senderId?: string; ts?: any }>
  >({});

  const currentUser = auth.currentUser;

  // Load users list
  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      setError("Please log in to see users.");
      return;
    }

    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserRow[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((u) => u.id !== currentUser.uid);
        list.sort((a, b) =>
          String(a.username || "").localeCompare(String(b.username || ""))
        );
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        console.error("Users load error", err);
        setError("Failed to load users.");
        setLoading(false);
      }
    );

    return unsub;
  }, [currentUser?.uid]);

  // Subscribe to my chats to pick up unread flags + last message
  useEffect(() => {
    if (!currentUser) return;

    const qChats = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUser.uid)
    );

    const unsub = onSnapshot(
      qChats,
      (snap) => {
        const unreadMap: Record<string, boolean> = {};
        const previews: Record<string, { text?: string; senderId?: string; ts?: any }> = {};

        snap.docs.forEach((d) => {
          const data = d.data() as ChatDoc;
          const others = (data.participants || []).filter(
            (p) => p !== currentUser.uid
          );
          const otherId = others[0]; // 1:1 chats
          if (!otherId) return;

          const unread = !!data.unreadFor?.[currentUser.uid];
          unreadMap[otherId] = unread;

          previews[otherId] = {
            text: data.lastMessageText,
            senderId: data.lastMessageSenderId,
            ts: data.lastMessageTimestamp,
          };
        });

        setUnreadByUser(unreadMap);
        setPreviewByUser(previews);
      },
      (err) => {
        console.error("Chats meta load error", err);
      }
    );

    return unsub;
  }, [currentUser?.uid]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.aboutMe || "").toLowerCase().includes(q)
    );
  }, [users, searchQuery]);


const handleEditProfile = () => {

  navigation.navigate("ProfileScreen");
};

  const handleStartChat = async (user: UserRow) => {
    if (!currentUser) {
      Alert.alert("Error", "You need to be logged in to chat.");
      return;
    }
    try {
      const chatId = [currentUser.uid, user.id].sort().join("_");
      const chatRef = doc(db, "chats", chatId);

      // Initialize participants as LIST and unreadFor for both users
      await setDoc(
        chatRef,
        {
          participants: [currentUser.uid, user.id],
          createdAt: serverTimestamp(),
          unreadFor: { [currentUser.uid]: false, [user.id]: false },
        },
        { merge: true }
      );

      navigation.navigate("ChatRoomScreen", {
        chatId,
        recipientId: user.id,
      });
    } catch (e) {
      console.error("Error starting chat:", e);
      Alert.alert("Error", "Could not start chat. Please try again.");
    }
  };

  const Wrapper =
    Platform.OS === "web"
      ? View
      : // @ts-ignore
        require("react-native").SafeAreaView || View;

  const renderRow = ({ item }: { item: UserRow }) => {
    const unread = !!unreadByUser[item.id];
    const preview = previewByUser[item.id];

    return (
      <TouchableOpacity
        style={styles.userCard}
        onPress={() => handleStartChat(item)}
      >
        <View style={{ width: 56, height: 56 }}>

                {item.profilePic ? (

                <Image source={{ uri: item.profilePic }} style={styles.memberAvatar} />
                ) : (
                <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
                    <Text style={styles.memberAvatarFallbackText}>{item.username?.charAt(0).toUpperCase() || '?'}</Text>
                </View>
                )}
        </View>

        <View style={styles.userCardContent}>
          <Text style={styles.userCardUsername}>
            {item.username || "Unknown User"}
          </Text>
          <Text style={styles.lastMessagePreview} numberOfLines={1}>
            {preview?.text
              ? preview.text
              : item.aboutMe || "Tap to start chat"}
          </Text>
        </View>

        <View style={{ width: 18, alignItems: "flex-end", marginLeft: 8 }}>
          {unread && (
            <View
              style={{
                width: 15,
                height: 15,
                borderRadius: 8,
                backgroundColor: "#1DB954",
                marginTop: 2,
              }}
            />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Wrapper style={styles.safeArea}>
      <View style={styles.headerContainer}>
        <Text style={styles.pageTitle}>Browse Users</Text>

        {/* profile edit button (optional) */}
        <TouchableOpacity
          onPress={handleEditProfile}
       style={{
            paddingHorizontal: 8,
            paddingVertical: 6,
            marginLeft: "auto",
            opacity: auth.currentUser?.uid ? 1 : 0.5,
          }}        >
          <Ionicons name="settings-outline" size={22} color={colors.textPrimary as string} />
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchBar}
        placeholder="Search users..."
        placeholderTextColor={colors.placeholderText as string}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {error && (
        <Text style={[globalStyles.loadingOverlayText, { color: colors.error }]}>
          {error}
        </Text>
      )}

      {loading ? (
        <View style={styles.activityIndicatorContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading users...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          ListEmptyComponent={
            <Text style={styles.noResultsText}>No users found.</Text>
          }
        />
      )}
    </Wrapper>
  );
};

export default UsersScreen;
