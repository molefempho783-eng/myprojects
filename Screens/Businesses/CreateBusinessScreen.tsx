import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, Alert, ActivityIndicator, Dimensions
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import createStyles, { FONT_SIZES } from '../context/appStyles';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, CatalogItem } from '../../types';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from '../../firebaseConfig';
import DropDownPicker from 'react-native-dropdown-picker';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type NavigationProp = StackNavigationProp<RootStackParamList, 'CreateBusinessScreen'>;
type CreateBusinessRouteProp = RouteProp<RootStackParamList, 'CreateBusinessScreen'>;
const screenHeight = Dimensions.get('window').height;

const CreateBusinessScreen = () => {
  const { colors } = useTheme();
  const styles = createStyles(colors).createBusinessScreen;
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<CreateBusinessRouteProp>();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null); // CHANGED from coverImageUri to imageUri
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Dropdown state
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([
    { label: 'Restaurant', value: 'Restaurant' },
    { label: 'Cafe', value: 'Cafe' },
    // ...more items
    { label: 'Hardware Store', value: 'Hardware Store' },
  ]);

  useEffect(() => {
    if (route.params?.catalog) {
      const parsed = route.params.catalog.map(item => ({
        ...item,
        price: typeof item.price === 'string' ? parseFloat(item.price) : item.price
      }));
      setCatalog(parsed);
    }
  }, [route.params]);

  const pickImage = async () => {
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
      setImageUri(result.assets[0].uri);
    }
  };

  const uploadImageToFirebase = async (uri: string, path: string) => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const imageRef = ref(storage, path);
    await uploadBytes(imageRef, blob);
    return await getDownloadURL(imageRef);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !type || !location.trim()) {
      Alert.alert('Validation Error', 'Please fill all required fields.');
      return;
    }

    setLoading(true);

    try {
      let businessImageUrl = null;
      if (imageUri) {
        businessImageUrl = await uploadImageToFirebase(
          imageUri,
          `business_covers/${auth.currentUser?.uid}/${Date.now()}`
        );
      }

      const catalogWithImages = [];
      for (const item of catalog) {
        let itemImageUrl = null;
        if (item.imageUrl) {
          itemImageUrl = await uploadImageToFirebase(
            item.imageUrl,
            `business_catalog/${auth.currentUser?.uid}/${Date.now()}_${item.name}`
          );
        }
        catalogWithImages.push({
          name: item.name,
          price: item.price,
          description: item.description || '',
          imageUrl: itemImageUrl, // standardize as imageUrl
        });
      }

      await addDoc(collection(db, 'businesses'), {
        name,
        description,
        type,
        location,
        imageUrl: businessImageUrl, // <-- use imageUrl everywhere!
        catalog: catalogWithImages,
        ownerId: auth.currentUser?.uid,
        createdAt: serverTimestamp()
      });

      Alert.alert('Success', 'Business created!');
      navigation.goBack();
    } catch (e) {
      console.error('Error creating business:', e);
      Alert.alert('Error', 'Failed to create business. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openAddCatalog = () => {
    navigation.navigate('AddCatalogScreen', { catalog });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ minHeight: screenHeight, padding: 16 }}
        enableOnAndroid={true}
        extraScrollHeight={20}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={true}
      >

        <Text style={styles.header}>Create Business</Text>

        {loading && (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loading} />
        )}

        <Text style={styles.label}>Business Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter business name"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter description"
          value={description}
          onChangeText={setDescription}
        />

        <Text style={styles.label}>Type / Category *</Text>
        <DropDownPicker
          open={open}
          value={type}
          items={items}
          setOpen={setOpen}
          setValue={setType}
          setItems={setItems}
          placeholder="Select business type"
          style={{
            borderColor: colors.borderColor,
            backgroundColor: colors.cardBackground,
          }}
          dropDownContainerStyle={{
            borderColor: colors.borderColor,
            backgroundColor: colors.surface,
          }}
          placeholderStyle={{
            color: colors.placeholderText,
          }}
          labelStyle={{
            color: colors.textPrimary,
          }}
          selectedItemLabelStyle={{
            fontWeight: 'bold',
            color: colors.primary,
          }}
          listItemLabelStyle={{
            color: colors.textPrimary,
          }}
          ArrowUpIconComponent={({ style }) => (
            <Ionicons name="chevron-up" size={20} color={colors.primary} style={style as any} />
          )}
          ArrowDownIconComponent={({ style }) => (
            <Ionicons name="chevron-down" size={20} color={colors.primary} style={style as any} />
          )}
          TickIconComponent={({ style }) => (
            <Ionicons name="checkmark" size={20} color={colors.primary} style={style as any} />
          )}
        />

        <Text style={styles.label}>Location *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter location"
          value={location}
          onChangeText={setLocation}
        />

        <Text style={styles.label}>Cover Image (Optional)</Text>
        <TouchableOpacity onPress={pickImage} style={styles.imagePicker}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.imagePreview} />
          ) : (
            <Ionicons name="image-outline" size={FONT_SIZES.xlarge} color={colors.primary} />
          )}
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>Catalog / Menu Items</Text>
        {catalog.length === 0 && (
          <Text style={styles.catalogDescription}>No items yet. Tap below to add.</Text>
        )}
        {catalog.map((item, index) => (
          <View key={index} style={styles.catalogItem}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.catalogItemImage} />
            ) : (
              <Ionicons name="image-outline" size={FONT_SIZES.large} color={colors.primary} />
            )}
            <View style={styles.catalogItemTextContainer}>
              <Text style={styles.catalogItemName}>{item.name} - ${item.price.toFixed(2)}</Text>
              <Text style={styles.catalogItemDescription}>{item.description}</Text>
            </View>
          </View>
        ))}
        <TouchableOpacity onPress={openAddCatalog} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add / Edit Catalog Items</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSubmit} style={styles.submitButton} disabled={loading}>
          <Text style={styles.submitButtonText}>Create Business</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
};

export default CreateBusinessScreen;
