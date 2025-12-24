/**
 * Tool: search_foods
 *
 * Searches the Diabetes:M food database for nutritional information.
 * Returns foods with nutrition per 100g, serving sizes, and source.
 *
 * Security:
 * - Input validation (SQL injection prevention)
 * - Public cache (unencrypted - non-sensitive data)
 * - No rate limit (read-only public data)
 * - Standard audit logging
 */

import { z } from 'zod';
import { diabetesMClient } from '../api/client.js';
import { SearchFoodsInputSchema } from '../types/tools.js';
import type { FoodItem, NutritionInfo } from '../types/api.js';

export const searchFoodsToolDefinition = {
  name: 'search_foods',
  description: 'Search the Diabetes:M food database for nutritional information. Returns foods with nutrition per 100g, serving sizes, and source.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query for food items',
        minLength: 1,
        maxLength: 100
      },
      filter: {
        type: 'string',
        enum: ['userCreated', 'recent', 'favorites', 'meals', 'dishes'],
        description: 'Optional filter for food source'
      },
      language: {
        type: 'string',
        enum: ['IT', 'EN', 'FR', 'DE', 'ES'],
        description: 'Language for results',
        default: 'EN'
      }
    },
    required: ['query']
  },
  annotations: {
    title: 'Search Foods',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

export interface SearchFoodsResult {
  foods: FoodItemResult[];
  count: number;
  query: string;
  filter?: string;
  language: string;
}

export interface FoodItemResult {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  nutritionPer100g: NutritionInfo;
  nutritionSummary: string;
  servingSizes?: Array<{
    name: string;
    grams: number;
    nutritionPerServing: NutritionInfo;
  }>;
  source: string;
  ingredients?: string;
  carbsPerServing?: string;
}

/**
 * Sanitizes search query to prevent injection attacks
 */
function sanitizeQuery(query: string): string {
  // Remove potentially dangerous characters
  return query
    .replace(/[<>'"`;\\]/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '')
    .trim()
    .substring(0, 100);
}

/**
 * Generates a nutrition summary string
 */
function generateNutritionSummary(nutrition: NutritionInfo): string {
  const parts = [
    `${nutrition.calories} kcal`,
    `${nutrition.carbs}g carbs`,
    `${nutrition.protein}g protein`,
    `${nutrition.fat}g fat`
  ];

  if (nutrition.fiber !== undefined) {
    parts.push(`${nutrition.fiber}g fiber`);
  }

  if (nutrition.sugar !== undefined) {
    parts.push(`${nutrition.sugar}g sugar`);
  }

  return parts.join(', ');
}

/**
 * Calculates nutrition for a serving size
 */
function calculateServingNutrition(
  nutritionPer100g: NutritionInfo,
  grams: number
): NutritionInfo {
  const factor = grams / 100;

  return {
    calories: Math.round(nutritionPer100g.calories * factor),
    carbs: Math.round(nutritionPer100g.carbs * factor * 10) / 10,
    protein: Math.round(nutritionPer100g.protein * factor * 10) / 10,
    fat: Math.round(nutritionPer100g.fat * factor * 10) / 10,
    fiber: nutritionPer100g.fiber !== undefined
      ? Math.round(nutritionPer100g.fiber * factor * 10) / 10
      : undefined,
    sugar: nutritionPer100g.sugar !== undefined
      ? Math.round(nutritionPer100g.sugar * factor * 10) / 10
      : undefined,
    sodium: nutritionPer100g.sodium !== undefined
      ? Math.round(nutritionPer100g.sodium * factor)
      : undefined
  };
}

/**
 * Transforms API food item to result format
 */
function transformFoodItem(item: FoodItem): FoodItemResult {
  const result: FoodItemResult = {
    id: item.id,
    name: item.name,
    brand: item.brand,
    category: item.category,
    nutritionPer100g: item.nutritionPer100g,
    nutritionSummary: generateNutritionSummary(item.nutritionPer100g),
    source: item.source === 'user' ? 'User Created' :
      item.source === 'recent' ? 'Recent' :
        item.source === 'favorite' ? 'Favorite' : 'Database',
    ingredients: item.ingredients
  };

  // Add serving sizes with calculated nutrition
  if (item.servingSizes && item.servingSizes.length > 0) {
    result.servingSizes = item.servingSizes.map(serving => ({
      name: serving.name,
      grams: serving.grams,
      nutritionPerServing: calculateServingNutrition(item.nutritionPer100g, serving.grams)
    }));

    // Add quick carbs reference for first serving
    const firstServing = result.servingSizes[0];
    if (firstServing) {
      result.carbsPerServing = `${firstServing.nutritionPerServing.carbs}g carbs per ${firstServing.name} (${firstServing.grams}g)`;
    }
  }

  return result;
}

/**
 * Extracts unique foods from diary entries
 * The Diabetes:M API stores food data in diary entries as JSON strings
 */
async function extractFoodsFromDiary(
  searchQuery: string
): Promise<FoodItemResult[]> {
  // Get diary entries from last 90 days
  const response = await diabetesMClient.getLogbookEntries('90');

  if (!response.success || !response.data) {
    return [];
  }

  const entries = response.data as unknown as Array<Record<string, unknown>>;
  const foodMap = new Map<string, FoodItemResult>();
  const queryLower = searchQuery.toLowerCase();

  entries.forEach(entry => {
    const foodJson = entry.food as string | undefined;
    if (!foodJson || typeof foodJson !== 'string') return;

    try {
      const foods = JSON.parse(foodJson) as Array<Record<string, unknown>>;

      foods.forEach(food => {
        const name = (food.name as string) || '';
        const foodId = String(food.food_id || food.input_id || name);

        // Skip if already processed or doesn't match query
        if (foodMap.has(foodId)) return;
        if (queryLower && !name.toLowerCase().includes(queryLower)) return;

        // Extract nutrition data
        const nutritionPer100g: NutritionInfo = {
          calories: Math.round(((food.calories as number) || 0) / ((food.quantity as number) || 100) * 100),
          carbs: Math.round(((food.total_carbs as number) || 0) / ((food.quantity as number) || 100) * 100 * 10) / 10,
          protein: Math.round(((food.protein as number) || 0) / ((food.quantity as number) || 100) * 100 * 10) / 10,
          fat: Math.round(((food.total_fat as number) || 0) / ((food.quantity as number) || 100) * 100 * 10) / 10,
          fiber: (food.fiber as number) !== undefined && (food.fiber as number) >= 0
            ? Math.round(((food.fiber as number) / ((food.quantity as number) || 100) * 100) * 10) / 10
            : undefined,
          sugar: (food.sugars as number) !== undefined && (food.sugars as number) >= 0
            ? Math.round(((food.sugars as number) / ((food.quantity as number) || 100) * 100) * 10) / 10
            : undefined
        };

        const result: FoodItemResult = {
          id: foodId,
          name: name,
          brand: (food.brand as string) || undefined,
          category: (food.food_type as string) || 'food',
          nutritionPer100g,
          nutritionSummary: generateNutritionSummary(nutritionPer100g),
          source: 'User Created',
          servingSizes: [{
            name: (food.serving as string) || 'g',
            grams: (food.serving_size as number) || 100,
            nutritionPerServing: calculateServingNutrition(nutritionPer100g, (food.serving_size as number) || 100)
          }]
        };

        // Add carbs per serving
        if (result.servingSizes && result.servingSizes[0]) {
          const serving = result.servingSizes[0];
          result.carbsPerServing = `${serving.nutritionPerServing.carbs}g carbs per ${serving.name} (${serving.grams}g)`;
        }

        foodMap.set(foodId, result);
      });
    } catch {
      // Skip entries with invalid food JSON
    }
  });

  return Array.from(foodMap.values());
}

/**
 * Executes the search_foods tool
 */
export async function executeSearchFoods(
  args: unknown
): Promise<SearchFoodsResult> {
  // Validate input
  const validatedInput = SearchFoodsInputSchema.parse(args);
  let { query, filter, language } = validatedInput;

  // Sanitize query
  query = sanitizeQuery(query);

  if (query.length === 0) {
    throw new Error('Search query cannot be empty after sanitization');
  }

  // Set default language if not provided
  language = language || 'EN';

  // First try the standard API search
  const response = await diabetesMClient.searchFoods(query, filter, language);

  let foods: FoodItemResult[] = [];

  if (response.success && response.data && response.data.length > 0) {
    // Transform API results
    foods = response.data.map(transformFoodItem);
  }

  // If no results from API, search in diary entries (user's custom foods)
  if (foods.length === 0) {
    const diaryFoods = await extractFoodsFromDiary(query);
    foods = diaryFoods;
  }

  return {
    foods,
    count: foods.length,
    query,
    filter,
    language
  };
}
