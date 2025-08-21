import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image,
  ScrollView, Alert, ActivityIndicator, SafeAreaView
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, CatalogItem } from '../../types';
import { useTheme } from '../context/ThemeContext';
import createStyles, { FONT_SIZES } from '../context/appStyles';
import { db, storage } from '../../firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Ionicons } from '@expo/vector-icons';

type EditBusinessRouteProp = RouteProp<RootStackParamList, 'EditBusinessScreen'>;
type NavigationProp = StackNavigationProp<RootStackParamList, 'EditBusinessScreen'>;

const EditBusinessScreen = () => {
  const { colors } = useTheme();
  const styles = createStyles(colors).createBusinessScreen;
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<EditBusinessRouteProp>();

  const { businessId } = route.params;

  // State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('');
  const [location, setLocation] = useState('');
  const [coverImageUri, setCoverImageUri] = useState<string | null>(null);
  const [coverImageChanged, setCoverImageChanged] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  /** Load the business details on mount */
  useEffect(() => {
    const loadBusiness = async () => {
      try {
        const docRef = doc(db, 'businesses', businessId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.name || '');
          setDescription(data.description || '');
          setType(data.type || '');
          setLocation(data.location || '');
          setCoverImageUri(data.coverImageUrl || null);
          setCatalog(data.catalog || []);
        } else {
          Alert.alert('Error', 'Business not found.');
          navigation.goBack();
        }
      } catch (err) {
        console.error('Error loading business:', err);
        Alert.alert('Error', 'Failed to load business.');
      } finally {
        setLoading(false);
      }
    };

    loadBusiness();
  }, [businessId]);

  /** Handle updates from CatalogEditorScreen */
  useEffect(() => {
    if (route.params?.catalog) {
      setCatalog(route.params.catalog);
    }
  }, [route.params?.catalog]);

  const pickCoverImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission denied', 'Please enable gallery access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setCoverImageUri(result.assets[0].uri);
      setCoverImageChanged(true);
    }
  };

  const uploadImageToFirebase = async (uri: string, path: string) => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const imageRef = ref(storage, path);
    await uploadBytes(imageRef, blob);
    return await getDownloadURL(imageRef);
  };

  const handleSave = async () => {
    if (!name.trim() || !type.trim() || !location.trim()) {
      Alert.alert('Validation Error', 'Please fill all required fields.');
      return;
    }
    setLoading(true);

    try {
      let newCoverUrl = coverImageUri;
      if (coverImageUri && coverImageChanged) {
        newCoverUrl = await uploadImageToFirebase(
          coverImageUri,
          `business_covers/${businessId}_${Date.now()}`
        );
      }

      await updateDoc(doc(db, 'businesses', businessId), {
        name,
        description,
        type,
        location,
        coverImageUrl: newCoverUrl,
        catalog
      });

      Alert.alert('Success', 'Business updated!');
      navigation.goBack();
    } catch (e) {
      console.error('Error updating business:', e);
      Alert.alert('Error', 'Failed to update business.');
    } finally {
      setLoading(false);
    }
  };

  const openCatalogEditor = () => {
  navigation.navigate('CatalogEditorScreen', {
    businessId,
    businessName: name,
    coverImageUrl: coverImageUri ?? null,
    description,
    location,
    type,
    catalog,
  });  };

  if (loading) {
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background
      }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.header}>Edit Business</Text>

        <Text style={styles.label}>Business Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
        />

        <Text style={styles.label}>Type *</Text>
        <TextInput
          style={styles.input}
          value={type}
          onChangeText={setType}
        />

        <Text style={styles.label}>Location *</Text>
        <TextInput
          style={styles.input}
          value={location}
          onChangeText={setLocation}
        />

        <Text style={styles.label}>Cover Image</Text>
        <TouchableOpacity onPress={pickCoverImage} style={styles.imagePicker}>
          {coverImageUri ? (
            <Image source={{ uri: coverImageUri }} style={styles.imagePreview} />
          ) : (
            <Ionicons name="image-outline" size={FONT_SIZES.xlarge} color={colors.primary} />
          )}
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>Catalog / Menu Items</Text>
        {catalog.length === 0 && (
          <Text style={styles.catalogDescription}>No items yet. Tap below to add or edit.</Text>
        )}
        {catalog.map((item, index) => (
          <View key={index} style={styles.catalogItem}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.catalogItemImage} />
            ) : (
              <Ionicons name="image-outline" size={FONT_SIZES.large} color={colors.primary} />
            )}
            <View style={styles.catalogItemTextContainer}>
              <Text style={styles.catalogItemName}>{item.name} - ${item.price?.toFixed(2)}</Text>
              <Text style={styles.catalogItemDescription}>{item.description}</Text>
            </View>
          </View>
        ))}
        <TouchableOpacity onPress={openCatalogEditor} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add / Edit Catalog Items</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSave} style={styles.submitButton}>
          <Text style={styles.submitButtonText}>Save Changes</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default EditBusinessScreen;
