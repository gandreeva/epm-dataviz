import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ruCommon from "./locales/ru/common.json";
import enCommon from "./locales/en/common.json";
import ruWaterfall from "./locales/ru/waterfall.json";
import enWaterfall from "./locales/en/waterfall.json";
import ruThreshold from "./locales/ru/threshold.json";
import enThreshold from "./locales/en/threshold.json";

export const APP_LOCALES = ["ru", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const STORAGE_KEY = "dashboard-prototype.locale";

const getStoredLocale = (): AppLocale => {
  if (typeof window === "undefined") return "ru";
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "en" ? "en" : "ru";
};

export const setStoredLocale = (locale: AppLocale) => {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
};

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      ru: { common: ruCommon, waterfall: ruWaterfall, threshold: ruThreshold },
      en: { common: enCommon, waterfall: enWaterfall, threshold: enThreshold },
    },
    lng: getStoredLocale(),
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (locale) => {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
});

export default i18n;
