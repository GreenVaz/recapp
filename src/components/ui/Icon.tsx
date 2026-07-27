"use client";

import * as icons from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * Категорії зберігають ім'я іконки рядком, тож резолвимо його в рантаймі.
 * Невідоме ім'я не має ламати сторінку — падаємо на нейтральне коло.
 */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const registry = icons as unknown as Record<string, React.ComponentType<LucideProps>>;
  const Component = registry[name] ?? icons.Circle;
  return <Component {...props} />;
}

/** Набір, з якого користувач обирає іконку категорії. */
export const ICON_CHOICES = [
  "ShoppingCart", "ShoppingBasket", "ShoppingBag", "Utensils", "UtensilsCrossed", "Coffee",
  "Sandwich", "Wine", "Bike", "Car", "CarTaxiFront", "TramFront", "Fuel", "Plane", "Wrench",
  "Home", "KeyRound", "Plug", "Wifi", "Hammer", "HeartPulse", "Pill", "Stethoscope", "Dumbbell",
  "Shirt", "Smartphone", "Package", "Gift", "Sparkles", "Repeat", "Clapperboard", "Palette",
  "GraduationCap", "BookOpen", "Book", "Landmark", "Receipt", "CreditCard", "ShieldCheck",
  "HandHeart", "Briefcase", "Wallet", "Award", "Laptop", "Tag", "Coins", "Percent", "ChartLine",
  "PiggyBank", "Inbox", "Undo2", "Baby", "Dog", "Cat", "TreePine", "Music", "Camera", "Scissors",
  "SprayCan", "CircleEllipsis", "CircleHelp", "Circle",
] as const;
