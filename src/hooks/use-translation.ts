import { useLocalization } from "@/contexts/localization-context";

export function useTranslation() {
  return useLocalization();
}
