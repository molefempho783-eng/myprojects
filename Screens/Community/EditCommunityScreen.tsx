import React, { useState, useEffect } from "react";
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
  SafeAreaView,
  StyleProp, // Keep these for explicit casting if needed
  TextStyle
} from "react-native";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { Community, RootStackParamList } from "../../types";
import { doc, updateDoc } from "firebase/firestore";
import { db, auth, storage } from "../../firebaseConfig";
import { getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from '../context/ThemeContext';
import createStyles, { FONT_SIZES, SPACING } from '../context/appStyles';
import { Ionicons } from '@expo/vector-icons';

const DEFAULT_COMMUNITY_LOGO = require("../../assets/community-placeholder.png");

type EditCommunityScreenRouteProp = RouteProp<RootStackParamList, "EditCommunityScreen">;
type EditCommunityScreenNavigationProp = StackNavigationProp<RootStackParamList, "EditCommunityScreen">;

const EditCommunityScreen = () => {
  const route = useRoute<EditCommunityScreenRouteProp>();
  const navigation = useNavigation<EditCommunityScreenNavigationProp>();
  const { community } = route.params; 
  const { colors, isThemeLoading } = useTheme();
  const styles = createStyles(colors).editCommunityScreen;
  const globalStyles = createStyles(colors).global;

  const [name, setName] = useState<string>(community.name || "");
  const [description, setDescription] = useState<string>(community.description || "");
  const [communityLogoUri, setCommunityLogoUri] = useState<string | null>(community.logo || null);
  const [loading, setLoading] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);

  const user = auth.currentUser;
  const isCreator = user && community.createdBy === user.uid;

  useEffect(() => {
    console.log("EditCommunityScreen: Community Data on Load:", community);
    console.log("EditCommunityScreen: Initial Name Type:", typeof community.name, "Value:", community.name);
    console.log("EditCommunityScreen: Initial Description Type:", typeof community.description, "Value:", community.description);
    console.log("EditCommunityScreen: isCreator:", isCreator);

    if (!user || !isCreator) {
      Alert.alert("Access Denied", "You do not have permission to edit this community.");
      navigation.goBack();
    }
  }, [user, isCreator, navigation, community]); 

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

  const uploadCommunityLogo = async (uri: string): Promise<string | null> => {
    if (!user) {
      Alert.alert("Error", "You must be logged in to upload a community logo.");
      return null;
    }

    const fileName = `community_logos/${community.id}.jpg`;
    const storageRef = ref(storage, fileName);

    try {
      const response = await fetch(uri);
      const blob = await response.blob();

      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      console.log("Community logo uploaded successfully! Download URL:", downloadURL);
      return downloadURL;

    } catch (error) {
      console.error("Error uploading community logo:", error);
      if (error instanceof Error) {
        console.error("Firebase Storage Error Code:", (error as any).code);
        if ((error as any).code === 'storage/unauthorized') {
            Alert.alert("Permission Denied", "Check Firebase Storage rules for 'community_logos'.");
        }
      }
      Alert.alert("Upload failed", "Could not upload community logo. Please try again.");
      return null;
    }
  };

  const handleSave = async () => {
    console.log("handleSave: Name type before trim:", typeof name, "Value:", name);
    console.log("handleSave: Description type before trim:", typeof description, "Value:", description);

    const trimmedName = String(name).trim(); 
    if (!trimmedName) {
      Alert.alert("Error", "Community name is required.");
      return;
    }

    if (!user || !isCreator) {
      Alert.alert("Authorization Error", "You are not authorized to edit this community.");
      return;
    }

    setLoading(true);

    let newLogoDownloadURL: string | null = communityLogoUri;

    if (communityLogoUri && communityLogoUri !== community.logo) {
      newLogoDownloadURL = await uploadCommunityLogo(communityLogoUri);
      if (!newLogoDownloadURL) {
        setLoading(false);
        return;
      }
      if (community.logo && community.logo !== newLogoDownloadURL) {
        try {
          const oldLogoFileName = `community_logos/${community.id}.jpg`;
          const oldLogoRef = ref(storage, oldLogoFileName);
          await deleteObject(oldLogoRef);
          console.log("Old community logo deleted from Storage.");
        } catch (deleteError) {
          console.warn("Could not delete old logo:", deleteError);
        }
      }
    } else if (community.logo && !communityLogoUri) {
      try {
        const oldLogoFileName = `community_logos/${community.id}.jpg`;
        const oldLogoRef = ref(storage, oldLogoFileName);
        await deleteObject(oldLogoRef);
        console.log("Community logo removed from Storage.");
        newLogoDownloadURL = null;
      } catch (deleteError) {
        console.warn("Could not remove logo:", deleteError);
        newLogoDownloadURL = community.logo;
      }
    }

    try {
      const communityDocRef = doc(db, "communities", community.id);
      
      const trimmedDescription = String(description).trim();
      
      const updatedData: Partial<Community> = {
        name: trimmedName, 
        description: trimmedDescription ? trimmedDescription : undefined, 
        logo: newLogoDownloadURL || undefined,
      };

      await updateDoc(communityDocRef, updatedData);

      Alert.alert("Success", "Community updated successfully!");

      navigation.navigate("CommunityDetailScreen", {
        community: {
          ...community,
          name: trimmedName,
          description: updatedData.description,
          logo: updatedData.logo,
        },
      });

    } catch (error) {
      console.error("Error updating community:", error);
      Alert.alert("Error", "Failed to update community. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (isThemeLoading || !isCreator) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={globalStyles.loadingOverlayText}>
          {isThemeLoading ? "Loading theme..." : "Checking permissions..."}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        {loading && (
          <View style={styles.loadingOverlayScreen}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingOverlayText}>Saving changes...</Text>
          </View>
        )}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
          <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
          </TouchableOpacity>
        <Text style={styles.header}>Edit Community</Text>

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

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.activeFilterText} /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default EditCommunityScreen;