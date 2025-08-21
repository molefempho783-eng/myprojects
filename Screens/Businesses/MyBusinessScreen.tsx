import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  Dimensions,
  SafeAreaView,
} from "react-native";
import {
  useRoute,
  useNavigation,
  RouteProp,
} from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import createStyles, { FONT_SIZES } from "../context/appStyles";
import { db } from "../../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { LineChart } from "react-native-chart-kit";
import { RootStackParamList, CatalogItem } from "../../types";

const SCREEN_WIDTH = Dimensions.get("window").width;

type MyBusinessNavProp = StackNavigationProp<
  RootStackParamList,
  "MyBusinessScreen"
>;
type MyBusinessRouteProp = RouteProp<
  RootStackParamList,
  "MyBusinessScreen"
>;

type OrderItem = { name: string; qty: number; price: number };
type Order = {
  id: string;
  total: number;
  createdAt: any;
  items: OrderItem[];
};

const MyBusinessScreen = () => {
  // 🔹 Typed navigation & route
  const navigation = useNavigation<MyBusinessNavProp>();
  const route = useRoute<MyBusinessRouteProp>();

  const { colors } = useTheme();
  const styles = createStyles(colors).myBusinessScreen;

  // 📦 Route params
  const {
    businessId,
    businessName,
    coverImageUrl,
    description,
    location,
    type,
    catalog = [],
  } = route.params;

  // 📊 Analytics state
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [analytics, setAnalytics] = useState<{
    totalRevenue: number;
    totalOrders: number;
    mostPopularItem: string;
    chartLabels: string[];
    chartData: number[];
  } | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, "orders"),
          where("businessId", "==", businessId),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        const allOrders: Order[] = [];
        snap.forEach((doc) =>
          allOrders.push({ id: doc.id, ...(doc.data() as Omit<Order, "id">) })
        );

        let totalRevenue = 0;
        let totalOrders = 0;
        const itemCount: Record<string, number> = {};
        const revenueByDay: Record<string, number> = {};

        allOrders.forEach((order) => {
          totalRevenue += order.total || 0;
          totalOrders++;
          order.items?.forEach((i: OrderItem) => {
            itemCount[i.name] = (itemCount[i.name] || 0) + (i.qty || 1);
          });
          const dateObj = order.createdAt?.toDate?.();
          if (dateObj) {
            const day = dateObj.toISOString().slice(0, 10);
            revenueByDay[day] = (revenueByDay[day] || 0) + (order.total || 0);
          }
        });

        const mostPopularItem =
          Object.entries(itemCount)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name)[0] || "N/A";

        const sortedDays = Object.keys(revenueByDay).sort();
        const revenueData = sortedDays.map((d: string) => revenueByDay[d]);

        setOrders(allOrders);
        setAnalytics({
          totalRevenue,
          totalOrders,
          mostPopularItem,
          chartLabels: sortedDays,
          chartData: revenueData,
        });
      } catch {
        setOrders([]);
        setAnalytics(null);
      } finally {
        setLoading(false);
      }
    };

    if (businessId) fetchAnalytics();
  }, [businessId]);

  // 🆔 Fallback initials
  const initials = businessName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header */}
        <View style={styles.headerContainer}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Business</Text>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() =>
              navigation.navigate("EditBusinessScreen", {
                businessId,
                businessName,
                coverImageUrl,
                description,
                location,
                type,
                catalog,
              })
            }
          >
            <Ionicons
              name="create-outline"
              size={22}
              color={colors.primary}
            />
          </TouchableOpacity>
        </View>

        {/* Business Image */}
        <View style={styles.businessImageWrapper}>
          {coverImageUrl ? (
            <Image
              source={{ uri: coverImageUrl }}
              style={styles.businessImage}
            />
          ) : (
            <View style={styles.businessImageFallback}>
              <Text style={styles.businessImageFallbackText}>
                {initials}
              </Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{businessName}</Text>

          <Text style={styles.label}>Description</Text>
          <Text style={styles.value}>{description}</Text>

          <Text style={styles.label}>Location</Text>
          <Text style={styles.value}>{location}</Text>

          <Text style={styles.label}>Type</Text>
          <Text style={styles.value}>{type}</Text>
        </View>

        {/* Analytics */}
        <View
          style={{
            backgroundColor: colors.cardBackground,
            margin: 16,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontWeight: "bold",
              fontSize: 18,
              color: colors.textPrimary,
              marginBottom: 10,
            }}
          >
            Business Analytics
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : analytics ? (
            <>
              {/* Summary cards */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                {[
                  { label: "Orders", value: analytics.totalOrders.toString() },
                  {
                    label: "Revenue",
                    value: `R${analytics.totalRevenue.toFixed(2)}`,
                  },
                  {
                    label: "Top Item",
                    value: analytics.mostPopularItem,
                  },
                ].map((card, idx) => (
                  <View
                    key={idx}
                    style={{
                      alignItems: "center",
                      flex: 1,
                      paddingVertical: 4,
                      marginHorizontal: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: 20,
                        color: colors.textPrimary,
                      }}
                    >
                      {card.value}
                    </Text>
                    <Text
                      style={{
                        color: colors.secondaryText,
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {card.label}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Revenue chart */}
              {analytics.chartData.length > 1 && (
                <LineChart
                  data={{
                    labels: analytics.chartLabels.map((l: string) =>
                      l.slice(5)
                    ),
                    datasets: [{ data: analytics.chartData }],
                  }}
                  width={SCREEN_WIDTH - 40}
                  height={180}
                  yAxisLabel="R"
                  chartConfig={{
                    backgroundColor: colors.cardBackground,
                    backgroundGradientFrom: colors.cardBackground,
                    backgroundGradientTo: colors.cardBackground,
                    decimalPlaces: 2,
                    color: () => colors.primary,
                    labelColor: () => colors.secondaryText,
                    style: { borderRadius: 16 },
                  }}
                  bezier
                  style={{
                    borderRadius: 16,
                    marginTop: 10,
                    alignSelf: "center",
                  }}
                />
              )}

              {/* Recent Orders */}
              <Text style={[styles.sectionHeader, { marginTop: 18 }]}>
                Recent Orders
              </Text>
              {orders.length === 0 ? (
                <Text style={{ color: "#999", marginVertical: 10 }}>
                  No orders found.
                </Text>
              ) : (
                <FlatList
                  data={orders.slice(0, 5)}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: "#00000006",
                        padding: 10,
                        borderRadius: 12,
                        marginBottom: 8,
                      }}
                    >
                      <Ionicons
                        name="receipt-outline"
                        color={colors.primary}
                        size={20}
                        style={{ marginRight: 10 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontWeight: "bold",
                            color: colors.textPrimary,
                          }}
                        >
                          {item.items
                            .map((i: OrderItem) => i.name)
                            .join(", ") || "Order"}
                        </Text>
                        <Text
                          style={{ color: colors.secondaryText, fontSize: 12 }}
                        >
                          {item.createdAt
                            ?.toDate?.()
                            ?.toLocaleString?.() || ""}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: colors.textPrimary,
                          fontWeight: "bold",
                        }}
                      >
                        R{item.total.toFixed(2)}
                      </Text>
                    </View>
                  )}
                  style={{ marginTop: 8 }}
                />
              )}
            </>
          ) : (
            <Text style={{ color: "#999", marginVertical: 10 }}>
              No analytics available.
            </Text>
          )}
        </View>

        {/* Optional Catalog */}
        {catalog.length > 0 && (
          <View style={styles.infoContainer}>
            <Text style={styles.sectionHeader}>Catalog</Text>
            {catalog.map((it: CatalogItem, idx: number) => (
              <Text key={idx} style={styles.value}>
                {it.name} — R{it.price.toFixed(2)}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default MyBusinessScreen;
