import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  SafeAreaView
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import createStyles, { FONT_SIZES } from '../context/appStyles';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, CatalogItem } from '../../types';

type NavigationProp = StackNavigationProp<RootStackParamList, 'AddCatalogScreen'>;
type AddCatalogScreenRouteProp = RouteProp<RootStackParamList, 'AddCatalogScreen'>;

// Local state version of a catalog item (price as string for TextInput)
type LocalCatalogItem = {
  name: string;
  price: string;
  description?: string;
  imageUri?: string;
};

const AddCatalogScreen = () => {
  const { colors } = useTheme();
  const styles = createStyles(colors).addCatalogScreen;
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute() as AddCatalogScreenRouteProp;

  // Map incoming param (price:number) → local state (price:string)
  const initialCatalog: LocalCatalogItem[] = (route.params?.catalog ?? []).map((item) => ({
    name: item.name,
    price: item.price.toString(),
    description: item.description,
    imageUri: item.imageUrl,
  }));

  const [catalog, setCatalog] = useState<LocalCatalogItem[]>(initialCatalog);

  const [newItem, setNewItem] = useState<LocalCatalogItem>({
    name: '',
    price: '',
    description: '',
    imageUri: undefined
  });

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
      setNewItem((prev) => ({ ...prev, imageUri: result.assets[0].uri }));
    }
  };

  const addItem = () => {
    if (!newItem.name.trim() || !newItem.price.trim()) {
      Alert.alert('Validation Error', 'Name and Price are required.');
      return;
    }
    setCatalog((prev) => [...prev, newItem]);
    setNewItem({ name: '', price: '', description: '', imageUri: undefined });
  };

  const removeItem = (index: number) => {
    setCatalog((prev) => prev.filter((_, i) => i !== index));
  };

  const saveAndReturn = () => {
    // Convert price from string to number for sending back
    const cleanedCatalog: CatalogItem[] = catalog.map((item) => ({
      name: item.name,
      price: parseFloat(item.price),
      description: item.description,
      imageUri: item.imageUri,
    }));

    navigation.navigate('CreateBusinessScreen', { catalog: cleanedCatalog });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.header}>Add Catalog Items</Text>

        {catalog.map((item, index) => (
          <View key={index} style={styles.catalogItem}>
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={styles.catalogItemImage} />
            ) : (
              <Ionicons name="image-outline" size={FONT_SIZES.large} color={colors.primary} />
            )}
            <View style={styles.catalogItemTextContainer}>
              <Text style={styles.catalogItemName}>{item.name} - ${item.price}</Text>
              <Text style={styles.catalogItemDescription}>{item.description}</Text>
            </View>
            <TouchableOpacity onPress={() => removeItem(index)}>
              <Ionicons name="trash-outline" size={24} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.subHeader}>New Item</Text>
        <TextInput
          style={styles.input}
          placeholder="Name *"
          value={newItem.name}
          onChangeText={(text) => setNewItem((prev) => ({ ...prev, name: text }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Price *"
          value={newItem.price}
          onChangeText={(text) => setNewItem((prev) => ({ ...prev, price: text }))}
          keyboardType="numeric"
        />
        <TextInput
          style={styles.input}
          placeholder="Description"
          value={newItem.description}
          onChangeText={(text) => setNewItem((prev) => ({ ...prev, description: text }))}
        />
        <TouchableOpacity onPress={pickImage} style={styles.imagePickerButton}>
          {newItem.imageUri ? (
            <Image source={{ uri: newItem.imageUri }} style={styles.imagePreview} />
          ) : (
            <Ionicons name="image-outline" size={FONT_SIZES.xlarge} color={colors.primary} />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={addItem} style={styles.addButton}>
          <Text style={styles.addButtonText}>Add Item</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={saveAndReturn} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default AddCatalogScreen;
