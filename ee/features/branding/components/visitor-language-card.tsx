import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocaleCode,
} from "@/lib/i18n/locales";

import { Label } from "@/components/ui/label";

type VisitorLanguageCardProps = {
  defaultLanguage: string;
  onDefaultLanguageChange: (value: SupportedLocaleCode) => void;
  hasAccess: boolean;
};

export function VisitorLanguageCard({
  defaultLanguage,
  onDefaultLanguageChange,
  hasAccess,
}: VisitorLanguageCardProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="visitor-default-language">Visitor language</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose the language visitors see when opening this Data Room.
        </p>
      </div>

      <select
        id="visitor-default-language"
        value={defaultLanguage || DEFAULT_LOCALE}
        onChange={(event) =>
          onDefaultLanguageChange(event.target.value as SupportedLocaleCode)
        }
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option
            key={locale.code}
            value={locale.code}
            disabled={!hasAccess && locale.code !== DEFAULT_LOCALE}
          >
            {locale.nativeName}
            {locale.nativeName !== locale.englishName
              ? ` (${locale.englishName})`
              : ""}
            {!hasAccess && locale.code !== DEFAULT_LOCALE ? " - Upgrade" : ""}
          </option>
        ))}
      </select>

      {!hasAccess ? (
        <p className="text-xs text-muted-foreground">
          English is available on every plan. Additional visitor languages
          require a Data Rooms plan.
        </p>
      ) : null}
    </div>
  );
}

export default VisitorLanguageCard;
