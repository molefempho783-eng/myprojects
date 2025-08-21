// Screens/ChatRoomScreen.tsx

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Image, Dimensions, Linking } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { doc, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebaseConfig';
import { RootStackParamList } from '../../types'; 

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

import createStyles, { SPACING, FONT_SIZES } from '../context/appStyles'; 
import { useTheme } from '../context/ThemeContext'; 
import { Ionicons } from "@expo/vector-icons";

type ChatRoomScreenRouteProp = RouteProp<RootStackParamList, 'ChatRoomScreen'>;
type ChatRoomScreenNavigationProp = any;

interface Message {
  id: string;
  text?: string;
  senderId: string;
  createdAt: any; // Firestore Timestamp or Date
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'file';
  fileName?: string;
  fileSize?: number;
  uploading?: boolean;
  uploadProgress?: number; // 0-100
  uploadError?: string;
  tempId?: string; 
}

const AVATAR_PLACEHOLDER = require("../../assets/avatar-placeholder.png");

const EMOJI_API_URL = 'https://emoji-api.com/emojis?access_key=f4afea21bfcc54275a9e03d3daf1bb0bb82c19f3'; // REPLACE 'YOUR_API_KEY' if using

const FALLBACK_EMOJIS = [
  '😀', '😂', '🤣', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😙',
  '😚', '😋', '😛', '😜', '🤪', '😝', '🤤', '😴', '😷', '🤒',
  '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '😵', '🤯', '🤠', '🥳',
  '😎', '🤓', '🤔', '🫣', '🤫', '🫢', '🫡', '🤥', '🫠', '😮‍💨',
  '😤', '😠', '😡', '🤬', '😈', '👿', '💀', '👻', '👽', '👾',
  '🤖', '💩', '🤡', '👹', '👺', '😺', '😸', '😹', '😻', '😼',
  '😽', '🙀', '😿', '😾', '👋', '🤚', '🖐️', '✋', '🖖', '👌',
  '🤏', '🤞', '✌️', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇',
  '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶',
  '🤲', '🤝', '🫱‍🫲', '🫲‍🫱', '🫳', '🫴', '🫷', '🫸', '💅', '🤳',
  '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀',
  '🫁', '🦷', '🦴', '👁️', '👀', '👅', '👄', '👶', '👦', '👧',
];


const ChatRoomScreen = () => {
  const route = useRoute<ChatRoomScreenRouteProp>();
  const navigation = useNavigation<ChatRoomScreenNavigationProp>();
  const { chatId, recipientId } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [recipientUsername, setRecipientUsername] = useState('Loading...');
  const [recipientProfilePic, setRecipientProfilePic] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojis, setEmojis] = useState<string[]>([]);
  const [fetchingEmojis, setFetchingEmojis] = useState(false);

  const [showAttachmentOptions, setShowAttachmentOptions] = useState(false);


  const currentUser = auth.currentUser;
  const { colors } = useTheme();
  const styles = createStyles(colors).chatRoomScreen;
  const globalStyles = createStyles(colors).global;
  const storage = getStorage();

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!loading) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages, loading]);


  useEffect(() => {
    if (!currentUser) {
      console.warn("User not logged in for chat.");
      navigation.goBack();
      return;
    }

    const fetchRecipientData = async () => {
      if (recipientId) {
        try {
          const userDocRef = doc(db, 'users', recipientId);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setRecipientUsername(userData.username || 'Unknown User');
            setRecipientProfilePic(typeof userData.profilePic === 'string' ? userData.profilePic : null);
          } else {
            setRecipientUsername('User Not Found');
            setRecipientProfilePic(null);
          }
        } catch (error: any) { // Fix: Add :any to error
          console.error("Error fetching recipient data:", error);
          setRecipientUsername('Error');
          setRecipientProfilePic(null);
        }
      }
    };
    fetchRecipientData();

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const serverMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setMessages(prevMessages => {
        const optimisticMessagesStillUploading = prevMessages.filter(msg => msg.uploading || msg.uploadError);
        const mergedMessages: Message[] = [];

        serverMessages.forEach(serverMsg => {
          const existingOptimisticIndex = optimisticMessagesStillUploading.findIndex(
            optMsg => optMsg.tempId === serverMsg.id
          );

          if (existingOptimisticIndex > -1) {
            const updatedOptimistic = {
              ...optimisticMessagesStillUploading[existingOptimisticIndex],
              ...serverMsg,
              uploading: false,
              uploadProgress: 100,
              uploadError: undefined,
              tempId: undefined,
            };
            optimisticMessagesStillUploading[existingOptimisticIndex] = updatedOptimistic;
          } else {
            mergedMessages.push(serverMsg as Message);
          }
        });
        
        // Filter out fully uploaded optimistic messages that are now part of serverMessages
        const finalMessages = [...optimisticMessagesStillUploading.filter(msg => !serverMessages.some(sm => sm.id === msg.id)), ...mergedMessages];

        return finalMessages.sort((a, b) => {
          // Sort by createdAt timestamp if available, otherwise by tempId for optimistic messages
          const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.tempId ? Number(a.tempId.split('_')[1]) : Infinity);
          const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.tempId ? Number(b.tempId.split('_')[1]) : Infinity);
          return timeA - timeB;
        });
      });
    }, (error: any) => { // Fix: Add :any to error
      console.error("Error fetching messages:", error);
      Alert.alert("Error", `Failed to load messages: ${(error as Error).message}`);
    });

    setLoading(false);
    return () => unsubscribe();
  }, [chatId, currentUser, recipientId]);

  const fetchEmojis = useCallback(async () => {
    if (emojis.length > 0 || fetchingEmojis) return;

    setFetchingEmojis(true);
    try {
      const response = await fetch(EMOJI_API_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}. Please check API key or use static fallback.`);
      }
      const data = await response.json();
      const fetchedEmojiCharacters = data
        .filter((emoji: { unicodeName: string }) => !emoji.unicodeName.includes('skin tone'))
        .map((emoji: { character: string }) => emoji.character);

      setEmojis(fetchedEmojiCharacters.slice(0, 200)); // Limit for performance
    } catch (error: any) { // Fix: Add :any to error
      console.error("Error fetching emojis:", error);
      setEmojis(FALLBACK_EMOJIS);
      Alert.alert("Emoji Load Error", "Failed to load dynamic emojis. Using a default set. Check API key/URL.");
    } finally {
      setFetchingEmojis(false);
    }
  }, [emojis.length, fetchingEmojis]);

  useEffect(() => {
    if (showEmojiPicker && emojis.length === 0 && !fetchingEmojis) {
      fetchEmojis();
    }
  }, [showEmojiPicker, emojis.length, fetchingEmojis, fetchEmojis]);


  const uploadMediaToFirebase = async (
    uri: string,
    fileType: 'image' | 'video' | 'file',
    fileNameWithExtension: string = 'file',
    tempMessageId: string
  ) => {
    setIsUploadingMedia(true);
    const response = await fetch(uri);
    const blob = await response.blob();

    const path = `chat_media/${chatId}/${currentUser?.uid}_${tempMessageId.split('_')[1]}_${fileNameWithExtension}`;
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, blob);

    return new Promise<string>((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes);
          setMessages(prevMessages =>
            prevMessages.map(msg =>
              msg.tempId === tempMessageId ? { ...msg, uploadProgress: progress * 100 } : msg
            )
          );
        },
        (error: any) => { // Fix: Add :any to error
          console.error(`Media/File upload failed (${fileType}):`, error);
          setIsUploadingMedia(false);
          setMessages(prevMessages =>
            prevMessages.map(msg =>
              msg.tempId === tempMessageId ? { ...msg, uploading: false, uploadError: error.message } : msg
            )
          );
          reject(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setIsUploadingMedia(false);
          setMessages(prevMessages =>
            prevMessages.map(msg =>
              msg.tempId === tempMessageId ? { ...msg, uploading: false, uploadProgress: 100, mediaUrl: downloadURL } : msg
            )
          );
          sendMessage({
            mediaUrl: downloadURL,
            mediaType: fileType,
            fileName: fileType === 'file' ? fileNameWithExtension : undefined,
            fileSize: blob.size,
          });

          resolve(downloadURL);
        }
      );
    });
  };


  const sendMessage = async (messageContent: { text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'file'; fileName?: string; fileSize?: number }) => {
    if (!currentUser) {
      Alert.alert("Error", "You need to be logged in to send messages.");
      return;
    }
    if (!messageContent.text && !messageContent.mediaUrl) return;

    let optimisticMessage: Message | undefined;

    if (!messageContent.mediaUrl) { // Only create optimistic message for text or if media upload is handled separately
        const tempId = `temp_${Date.now()}`;
        optimisticMessage = {
            id: tempId, tempId, senderId: currentUser.uid, createdAt: new Date(), // Use new Date() for optimistic timestamp
            text: messageContent.text,
            uploading: true, // Mark as uploading initially for text messages too, set false on success
            uploadProgress: 0,
        };
        setMessages(prevMessages => [...prevMessages, optimisticMessage!]);
        flatListRef.current?.scrollToEnd({ animated: true });
    }

    try {
      const chatDocRef = doc(db, 'chats', chatId);

      const messageData: { [key: string]: any } = { // Use index signature to allow dynamic fields
        senderId: currentUser.uid,
        createdAt: serverTimestamp(), // Use serverTimestamp for Firestore
      };

      if (messageContent.text !== undefined) messageData.text = messageContent.text;
      if (messageContent.mediaUrl !== undefined) messageData.mediaUrl = messageContent.mediaUrl;
      if (messageContent.mediaType !== undefined) messageData.mediaType = messageContent.mediaType;
      if (messageContent.fileName !== undefined) messageData.fileName = messageContent.fileName;
      if (messageContent.fileSize !== undefined) messageData.fileSize = messageContent.fileSize;


      const newMessageRef = await addDoc(collection(chatDocRef, 'messages'), messageData);
      

      if (optimisticMessage && optimisticMessage.tempId) { // Update optimistic message with real ID and status
          setMessages(prevMessages =>
              prevMessages.map(msg =>
                  msg.tempId === optimisticMessage!.tempId ? { ...msg, id: newMessageRef.id, tempId: undefined, uploading: false, uploadProgress: 100 } : msg
              )
          );
      }


      let lastMessagePreviewText = messageContent.text || '';
      if (messageContent.mediaType === 'image') lastMessagePreviewText = 'Image 📸';
      else if (messageContent.mediaType === 'video') lastMessagePreviewText = 'Video 🎥';
      else if (messageContent.mediaType === 'file') lastMessagePreviewText = `File 📄: ${messageContent.fileName}`;

      // This is the CRUCIAL update for CommunityScreen optimization
      await updateDoc(chatDocRef, {
        lastMessageText: lastMessagePreviewText,
        lastMessageSenderId: currentUser.uid, // Assuming you want sender ID on the chat document
        lastMessageTimestamp: serverTimestamp(),
      });

      setNewMessage('');
      setShowEmojiPicker(false);
      setShowAttachmentOptions(false); // Close attachment options
    } catch (error: any) { // Fix: Add :any to error
      console.error("Error sending message:", error);
      Alert.alert("Error", `Could not send message: ${(error as Error).message}`);
        if (optimisticMessage && optimisticMessage.tempId) {
            setMessages(prevMessages =>
                prevMessages.map(msg =>
                    msg.tempId === optimisticMessage!.tempId ? { ...msg, uploading: false, uploadError: (error as Error).message } : msg
                )
            );
        }
    }
  };

  const handlePickMedia = async (mediaType: 'image' | 'video') => {
    setShowAttachmentOptions(false); // Close the attachment options view
    setShowEmojiPicker(false); // Close emoji picker if open
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert("Permission required", `Permission to access ${mediaType} library is required!`);
      return;
    }

    let result;
    if (mediaType === 'image') {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
    } else { // mediaType === 'video'
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.7,
      });
    }

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const fileNameWithExtension = uri.split('/').pop() || (mediaType === 'image' ? 'image.jpg' : 'video.mp4');
      const tempId = `temp_${Date.now()}`;

      // Optimistic update for media messages
      setMessages(prevMessages => [...prevMessages, {
        id: tempId, tempId, senderId: currentUser!.uid, createdAt: new Date(),
        mediaUrl: uri, mediaType, uploading: true, uploadProgress: 0
      }]);
      flatListRef.current?.scrollToEnd({ animated: true });

      try {
        await uploadMediaToFirebase(uri, mediaType, fileNameWithExtension, tempId);
      } catch (error: any) { // Fix: Add :any to error
        // Error handled in uploadMediaToFirebase
      }
    }
  };

  const handlePickFile = async () => {
    setShowAttachmentOptions(false); // Close the attachment options view
    setShowEmojiPicker(false); // Close emoji picker if open
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const uri = file.uri;
        const fileName = file.name;
        const fileSize = file.size;

        if (!fileName || !fileSize) {
          Alert.alert("File Error", "Could not get file name or size.");
          return;
        }

        const fileExtension = fileName.split('.').pop() || 'bin';
        const fileNameWithExtension = `${fileName.split('.')[0] || 'file'}.${fileExtension}`;
        const tempId = `temp_${Date.now()}`;

        // Optimistic update for file messages
        setMessages(prevMessages => [...prevMessages, {
          id: tempId, tempId, senderId: currentUser!.uid, createdAt: new Date(),
          mediaUrl: uri, mediaType: 'file', fileName, fileSize, uploading: true, uploadProgress: 0
        }]);
        flatListRef.current?.scrollToEnd({ animated: true });

        try {
          await uploadMediaToFirebase(uri, 'file', fileNameWithExtension, tempId);
        } catch (error: any) { // Fix: Add :any to error
          // Error handled in uploadMediaToFirebase
        }
      }
    } catch (error: any) { // Fix: Add :any to error
      console.error("Error picking file:", error);
      Alert.alert("File Picker Error", `Failed to pick file: ${(error as Error).message}`);
    }
  };

  const handleSendEmoji = (emoji: string) => {
    setNewMessage(prevMessage => prevMessage + emoji);
  };

  const handleSendText = () => {
    if (newMessage.trim() === '') return;
    sendMessage({ text: newMessage.trim() });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isCurrentUser = item.senderId === currentUser?.uid;
    const isUploading = item.uploading && item.uploadProgress !== undefined && item.uploadProgress < 100;

    return (
      <View style={[
        styles.messageBubble,
        isCurrentUser ? styles.myMessageBubble : styles.otherMessageBubble,
        item.uploadError && styles.messageErrorBubble
      ]}>
        {item.mediaType === 'image' && item.mediaUrl ? (
          <Image source={{ uri: item.mediaUrl }} style={styles.mediaMessageImage} />
        ) : item.mediaType === 'video' && item.mediaUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(item.mediaUrl!)} style={styles.videoMessageContainer}>
            <Image
              source={{ uri: `https://placehold.co/200x150/000000/FFFFFF?text=VIDEO%0APreview` }} // Placeholder thumbnail
              style={styles.mediaMessageImage}
            />
            <Text style={styles.videoPlayText}>Tap to Play Video</Text>
          </TouchableOpacity>
        ) : item.mediaType === 'file' && item.mediaUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(item.mediaUrl!)} style={styles.fileMessageContainer}>
            <Text style={styles.fileIcon}>📄</Text>
            <View style={styles.fileDetails}>
              <Text style={styles.fileNameText} numberOfLines={1}>{item.fileName || 'Unknown File'}</Text>
              <Text style={styles.fileSizeText}>{item.fileSize ? formatFileSize(item.fileSize) : 'N/A'}</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {item.text && <Text style={isCurrentUser ? styles.myMessageText : styles.otherMessageText}>{item.text}</Text>}

        {item.uploadError ? (
          <Text style={styles.uploadErrorText}>Upload Failed: {item.uploadError.substring(0, 30)}...</Text>
        ) : isUploading ? (
          <View style={styles.uploadProgressBarContainer}>
            <View style={[styles.uploadProgressBar, { width: `${item.uploadProgress || 0}%` }]} />
            <Text style={styles.uploadProgressText}>Uploading {Math.round(item.uploadProgress || 0)}%</Text>
          </View>
        ) : null}

        <Text style={styles.timestampText}>
          {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sending...'}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textPrimary }}>Loading messages...</Text> {/* Use textPrimary */}
      </View>
    );
  }

  // Fallback for not logged in
  if (!currentUser) {
    return (
      <View style={globalStyles.centeredContainer}>
        <Text style={globalStyles.errorText}>You must be logged in to view this chat.</Text>
        <TouchableOpacity onPress={() => navigation.navigate("AuthScreen")}>
          <Text style={globalStyles.loginPromptText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? SPACING.xxlarge : 0}
    >
      <View style={styles.headerContainer}>
           <TouchableOpacity
            onPress={() => navigation.goBack()} // Use navigation.goBack() for stack navigation
            style={globalStyles.backButton || globalStyles.primaryButton} // Use specific style or a fallback
          >
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} /> {/* Use Ionicons */}
          </TouchableOpacity>

      <TouchableOpacity
        onPress={() => navigation.navigate('UserProfileScreen', { userId: recipientId })}
        style={styles.profileButton}
      >
        <Image
          source={recipientProfilePic ? { uri: recipientProfilePic } : AVATAR_PLACEHOLDER}
          style={styles.recipientProfilePic}
        />
        <Text style={styles.headerTitle}>{recipientUsername}</Text>
      </TouchableOpacity>

      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        inverted={false}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Attachment Options View - toggled by showAttachmentOptions */}
      {showAttachmentOptions && (
        // Changed from emojiPickerContainer to attachmentOptionsContainer
        <View style={styles.attachmentOptionsContainer}>
          <TouchableOpacity onPress={() => handlePickMedia('image')} style={styles.attachmentOptionButton}>
            <Text style={styles.attachmentOptionButtonText}>📸 Image</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handlePickMedia('video')} style={styles.attachmentOptionButton}>
            <Text style={styles.attachmentOptionButtonText}>🎥 Video</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handlePickFile} style={styles.attachmentOptionButton}>
            <Text style={styles.attachmentOptionButtonText}>📁 File</Text>
          </TouchableOpacity>
        </View>
      )}

      {showEmojiPicker && (
        <View style={styles.emojiPickerContainer}>
          {fetchingEmojis ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <FlatList
              data={emojis.length > 0 ? emojis : FALLBACK_EMOJIS}
              keyExtractor={(item) => item}
              numColumns={8}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.emojiItem}
                  onPress={() => handleSendEmoji(item)}
                >
                  <Text style={styles.emojiText}>{item}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.emojiListContent}
            />
          )}
        </View>
      )}

      <View style={styles.inputContainer}>
        {isUploadingMedia ? (
          <View style={styles.mediaUploadIndicator}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.mediaUploadText}>Preparing upload...</Text>
          </View>
        ) : (
          <>
            {/* Toggle Attachment Options Button */}
            <TouchableOpacity onPress={() => setShowAttachmentOptions(!showAttachmentOptions)} style={styles.attachmentButton}>
              <Text style={styles.attachmentButtonText}>📎</Text>
            </TouchableOpacity>

            {/* Toggle Emoji Picker Button */}
            <TouchableOpacity onPress={() => setShowEmojiPicker(!showEmojiPicker)} style={styles.emojiButton}>
              <Text style={styles.emojiButtonText}>😊</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.textInput}
              value={newMessage}
              onChangeText={setNewMessage}
              placeholder="Type your message..."
              placeholderTextColor={colors.placeholderText}
              multiline
            />
            <TouchableOpacity
              style={styles.sendButton}
              onPress={handleSendText}
              disabled={newMessage.trim() === ''}
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

export default ChatRoomScreen;