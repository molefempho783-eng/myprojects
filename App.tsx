import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";


import { AuthProvider, useAuth } from "./AuthContext";
import { ThemeProvider, useTheme } from './Screens/context/ThemeContext';

import AuthScreen from "./Screens/AuthScreen";
import CommunityScreen from "./Screens/Community/CommunityScreen";
import CommunityDetailScreen from "./Screens/Community/CommunityDetailScreen";
import CreateCommunityScreen from "./Screens/Community/CreateCommunityScreen";
import GroupChatScreen from "./Screens/Community/Group/GroupChatScreen";
import ProfileScreen from "./Screens/Users/ProfileScreen";
import UserProfileScreen from "./Screens/Users/userProfileScreen";
import EditCommunityScreen from "./Screens/Community/EditCommunityScreen";
import ChatRoomScreen from "./Screens/Users/ChatRoomScreen";
import GroupDetailsScreen from "./Screens/Community/Group/GroupDetailsScreen";
import WalletScreen from "./Screens/Wallet/WalletScreen";
import UserScreen from "./Screens/Users/UsersScreen";
import BusinessesScreen from "./Screens/Businesses/BusinessesScreen";
import CreateBusinessScreen from "./Screens/Businesses/CreateBusinessScreen";
import AddCatalogScreen from "./Screens/Businesses/AddCatalogScreen";
import EditBusinessScreen from "./Screens/Businesses/EditBusinessScreen";
import CatalogEditorScreen from "./Screens/Businesses/CatalogEditorScreen";
import BusinessChatScreen from "./Screens/Businesses/BusinessChatScreen";
import MyBusinessScreen from './Screens/Businesses/MyBusinessScreen';
import CreateGroupChatScreen from './Screens/Community/Group/CreateGroupChatScreen';
import * as WebBrowser from 'expo-web-browser';


WebBrowser.maybeCompleteAuthSession();

const RootStack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TabsNavigator = () => {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.cardBackground,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          position: "absolute",
          bottom: 0,
          height: 65,
          elevation: 10,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -2 },
        },

        tabBarIcon: ({ color, size }) => {
          let iconName: string = "";
          if (route.name === "CommunityScreen") iconName = "people-outline";
          else if (route.name === "BusinessesScreen") iconName = "storefront-outline";
          else if (route.name === "WalletScreen") iconName = "wallet-outline";
          else if (route.name === "ProfileScreen") iconName = "person-outline";
          else if (route.name === "UserScreen") iconName = "person-outline";
return <Ionicons name={iconName as any} size={size} color={color} />;
        },
        tabBarLabelStyle: {
          fontSize: 12,
          marginBottom: 4
        },
      })}
    >
      <Tab.Screen name="CommunityScreen" component={CommunityScreen} />
      <Tab.Screen name="UserScreen" component={UserScreen} />
      <Tab.Screen name="BusinessesScreen" component={BusinessesScreen} />
      <Tab.Screen name="WalletScreen" component={WalletScreen} />
      <Tab.Screen name="ProfileScreen" component={ProfileScreen} />
    </Tab.Navigator>
  );
};

const MainNavigator = () => {
  const { user } = useAuth();

  return (
    <ThemeProvider>
      <NavigationContainer>
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          {user ? (
            <>
              {/* Tabs Navigator with Bottom Bar */}
              <RootStack.Screen name="Tabs" component={TabsNavigator} />

              {/* Screens without Bottom Bar */}
              <RootStack.Screen name="GroupChatScreen" component={GroupChatScreen} />
              <RootStack.Screen name="ChatRoomScreen" component={ChatRoomScreen} />
              <RootStack.Screen name="CommunityDetailScreen" component={CommunityDetailScreen} />
              <RootStack.Screen name="EditCommunityScreen" component={EditCommunityScreen} />
              <RootStack.Screen name="UserProfileScreen" component={UserProfileScreen} />
              <RootStack.Screen name="GroupDetailsScreen" component={GroupDetailsScreen} />
              <RootStack.Screen name="CreateCommunityScreen" component={CreateCommunityScreen} />
              <RootStack.Screen name="CreateBusinessScreen" component={CreateBusinessScreen} />
              <RootStack.Screen name="AddCatalogScreen" component={AddCatalogScreen} />
              <RootStack.Screen name="EditBusinessScreen" component={EditBusinessScreen} />
              <RootStack.Screen name="CatalogEditorScreen" component={CatalogEditorScreen} />
              <RootStack.Screen name="BusinessChatScreen" component={BusinessChatScreen} />
              <RootStack.Screen name="MyBusinessScreen" component={MyBusinessScreen} />
              <RootStack.Screen name="CreateGroupChatScreen" component={CreateGroupChatScreen} />
            </>
          ) : (
            <RootStack.Screen name="AuthScreen" component={AuthScreen} />
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <MainNavigator />
    </AuthProvider>
  );
};

export default App;
