import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { Community, RootStackParamList } from "../../types";
import { collection, addDoc } from "firebase/firestore";
import { db, auth, storage } from "../../firebaseConfig";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from '../context/ThemeContext';
import createStyles, { FONT_SIZES, SPACING } from '../context/appStyles';
import { Ionicons } from "@expo/vector-icons";

const DEFAULT_COMMUNITY_LOGO = require("../../assets/community-placeholder.png");

type NavigationProp = StackNavigationProp<RootStackParamList, "CreateCommunityScreen">;

const CreateCommunityScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors, isThemeLoading } = useTheme();

  const styles = createStyles(colors).createCommunityScreen;
  const globalStyles = createStyles(colors).global;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [communityLogoUri, setCommunityLogoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);

  const handleImagePick = async () => {
    if (isPickingImage) return;
    setIsPickingImage(true);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please grant media library permissions to choose a community logo.');
      setIsPickingImage(false);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets.length > 0) {
      setCommunityLogoUri(result.assets[0].uri);
    }
    setIsPickingImage(false);
  };

  // REVISED: uploadImageToFirebase to be more robust for web
  const uploadImageToFirebase = async (uri: string, communityId: string): Promise<string | null> => {
    if (!auth.currentUser) {
      Alert.alert("Error", "You must be logged in to upload a community logo.");
      return null;
    }

    console.log("Attempting to upload image...");
    console.log("Current User UID:", auth.currentUser.uid);
    console.log("Is User Authenticated?", auth.currentUser != null);

    const fileName = `community_logos/${communityId}.jpg`; // Use the passed communityId as filename
    console.log("Target Storage Path:", fileName);

    try {
      // Fetch the image as a blob
      const response = await fetch(uri);
      const blob = await response.blob();

      const storageRef = ref(storage, fileName);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      console.log("Image uploaded successfully! Download URL:", downloadURL);
      return downloadURL;
    } catch (error) {
      console.error("Error uploading community logo:", error);
      if (error instanceof Error) {
        console.error("Firebase Error Code:", (error as any).code);
      }
      Alert.alert("Upload Failed", "Could not upload community logo. Please try again.");
      return null;
    }
  };

  const handleCreateCommunity = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Community name is required.");
      return;
    }

    if (!auth.currentUser) { // Ensure user is logged in before starting
      Alert.alert("Authentication Required", "Please log in to create a community.");
      return;
    }

    setLoading(true);

    // Generate a temporary ID for the logo upload before the community document is created
    // This temporary ID could be the user's UID + timestamp, or a UUID
    const tempCommunityIdForLogo = `${auth.currentUser.uid}_${Date.now()}`;
    let logoDownloadURL: string | null = null;

    if (communityLogoUri) {
      logoDownloadURL = await uploadImageToFirebase(communityLogoUri, tempCommunityIdForLogo);
      if (!logoDownloadURL) {
        setLoading(false);
        return; // Stop if image upload failed
      }
    }

    try {
      const communityData: Partial<Community> = {
        name,
        description: description.trim() || undefined,
        createdBy: auth.currentUser.uid, // Use auth.currentUser.uid directly as we've checked it
        createdAt: new Date(),
      };

      if (logoDownloadURL) {
        communityData.logo = logoDownloadURL;
      }

      console.log("auth.currentUser:", auth.currentUser);

      // Add the community document to Firestore
      const docRef = await addDoc(collection(db, "communities"), communityData);

      Alert.alert("Success", "Community created successfully!");

      navigation.navigate("CommunityDetailScreen", {
        community: {
          id: docRef.id, // Use the actual ID of the newly created document
          name,
          description: description.trim() || undefined,
          logo: logoDownloadURL || undefined,
          createdBy: auth.currentUser.uid, // Ensure this is passed if CommunityDetailScreen needs it
          createdAt: new Date(), // Ensure this is passed
        },
      });

      setName("");
      setDescription("");
      setCommunityLogoUri(null);

    } catch (error) {
      console.error("Error creating community (Firestore):", error); 
      Alert.alert("Error", "Could not create community. Check Firestore rules."); 
    } finally {
      setLoading(false);
    }
  };

  if (isThemeLoading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={globalStyles.loadingOverlayText}>Loading theme...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]}>
      {loading && (
        <View style={styles.loadingOverlayScreen}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingOverlayText}>Creating community...</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{flexGrow: 1, paddingBottom: SPACING.large}}>
                   <TouchableOpacity
            onPress={() => navigation.goBack()} 
            style={globalStyles.backButton || globalStyles.primaryButton} 
          >
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} /> 
          </TouchableOpacity>
        <Text style={styles.header}>Create a New Community</Text>

        <TouchableOpacity onPress={handleImagePick} style={styles.logoContainer} disabled={loading || isPickingImage}>
          <Image
            source={communityLogoUri ? { uri: communityLogoUri } : DEFAULT_COMMUNITY_LOGO}
            style={styles.logoImage}
          />
          <Text style={styles.addLogoText}>{communityLogoUri ? "Change Logo" : "Add Logo"}</Text>
        </TouchableOpacity>

        <TextInput
          style={[styles.input, {borderColor: colors.borderColor, backgroundColor: colors.cardBackground, color: colors.text}]}
          placeholder="Community Name"
          placeholderTextColor={colors.placeholderText as string}
          value={name}
          onChangeText={setName}
          editable={!loading}
        />

        <TextInput
          style={[
            styles.input,
            styles.textArea,
            {borderColor: colors.borderColor, backgroundColor: colors.cardBackground, color: colors.text}
          ]}
          placeholder="Description (optional)"
          placeholderTextColor={colors.placeholderText as string}
          value={description}
          onChangeText={setDescription}
          multiline
          editable={!loading}
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleCreateCommunity} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.activeFilterText} /> : <Text style={styles.saveButtonText}>Create Community</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

export default CreateCommunityScreen;