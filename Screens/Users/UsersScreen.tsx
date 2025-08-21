// Screens/Users/UsersScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Image,
  Alert,
  Platform
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../types";
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { useTheme } from '../context/ThemeContext';
import createStyles from '../context/appStyles';

const DEFAULT_AVATAR = require("../../assets/avatar-placeholder.png");

type NavigationProp = StackNavigationProp<RootStackParamList, "ChatScreen">;

interface UserListItem {
  id: string;
  username: string;
  profilePic?: string;
  aboutMe?: string;
  lastMessageText?: string;
  lastMessageTimestamp?: any;
  chatId?: string;
}

const UsersScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const styles = createStyles(colors).communityScreen;
  const globalStyles = createStyles(colors).global;

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const currentUser = auth.currentUser;

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      setError("Please log in to see users.");
      return;
    }

    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await getDocs(collection(db, "users"));
        const results: UserListItem[] = [];

        for (const userDoc of snapshot.docs) {
          if (userDoc.id === currentUser.uid) continue;

          const userData = userDoc.data();
          const userId = userDoc.id;

          let lastMessageText: string | undefined;
          let lastMessageTimestamp: any = null;
          let chatId: string | undefined;

          const potentialChatId = [currentUser.uid, userId].sort().join("_");
          const chatDocRef = doc(db, "chats", potentialChatId);
          const chatDoc = await getDoc(chatDocRef);

          if (chatDoc.exists() && chatDoc.data().lastMessageTimestamp) {
            lastMessageText = chatDoc.data().lastMessageText || undefined;
            lastMessageTimestamp = chatDoc.data().lastMessageTimestamp;
            chatId = potentialChatId;
          }

          results.push({
            id: userId,
            username: userData.username || "Unknown User",
            profilePic: userData.profilePic || undefined,
            aboutMe: userData.aboutMe || undefined,
            lastMessageText,
            lastMessageTimestamp,
            chatId
          });
        }

        // Sort by latest message
        results.sort((a, b) => {
          const tsA = a.lastMessageTimestamp?.toDate ? a.lastMessageTimestamp.toDate().getTime() : 0;
          const tsB = b.lastMessageTimestamp?.toDate ? b.lastMessageTimestamp.toDate().getTime() : 0;
          return tsB - tsA;
        });

        setUsers(results);
      } catch (err) {
        console.error("Error fetching users:", err);
        setError("Failed to load users. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [currentUser]);

  const handleStartChat = async (user: UserListItem) => {
    if (!currentUser || !user.id) {
      Alert.alert("Error", "You need to be logged in to chat.");
      return;
    }

    const chatId = user.chatId || [currentUser.uid, user.id].sort().join("_");
    const chatRef = doc(db, "chats", chatId);

    try {
      const chatDoc = await getDoc(chatRef);
      if (!chatDoc.exists()) {
        await setDoc(chatRef, {
          participants: { [currentUser.uid]: true, [user.id]: true },
          createdAt: serverTimestamp(),
        });
      }

      navigation.navigate("ChatRoomScreen", {
        chatId,
        recipientId: user.id
      });
    } catch (error) {
      console.error("Error starting chat:", error);
      Alert.alert("Error", "Could not start chat. Please try again.");
    }
  };

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.aboutMe?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  );

  const Wrapper = Platform.OS === 'web' ? View : require('react-native').SafeAreaView || View;

  return (
    <Wrapper style={styles.safeArea}>
      <View style={styles.headerContainer}>
        <Text style={styles.pageTitle}>Browse Users</Text>
      </View>

      <TextInput
        style={styles.searchBar}
        placeholder="Search users..."
        placeholderTextColor={colors.placeholderText as string}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {error && <Text style={[globalStyles.loadingOverlayText, { color: colors.error }]}>{error}</Text>}

      {loading ? (
        <View style={styles.activityIndicatorContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading users...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.userCard}
              onPress={() => handleStartChat(item)}
            >
              <Image
                source={item.profilePic ? { uri: item.profilePic } : DEFAULT_AVATAR}
                style={styles.userAvatar}
              />
              <View style={styles.userCardContent}>
                <Text style={styles.userCardUsername}>{item.username}</Text>
                <Text style={styles.lastMessagePreview} numberOfLines={1}>
                  {item.aboutMe || "Tap to start chat"}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.noResultsText}>No users found.</Text>
          }
        />
      )}
    </Wrapper>
  );
};

export default UsersScreen;
