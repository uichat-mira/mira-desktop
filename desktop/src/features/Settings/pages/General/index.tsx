import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { useAuth } from "@/app/providers/AuthProvider";
import { useLanguagePreferences } from "@/app/providers/LanguageProvider";
import { changePassword } from "@/shared/api";
import { cleanupThreads } from "@/shared/api/thread";
import {
  getGeneralSettings,
  updateGeneralSettings,
  type GeneralSettings as BackendGeneralSettings,
} from "@/shared/api/generalSettings";
import { ApiError } from "@/shared/lib/request";
import { useThemePreferences } from "@/app/providers/ThemeProvider";
import type { ThemePresetId } from "@/shared/theme/colorThemes";
import Badge from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import SectionCard, { SectionCardRow } from "@/shared/ui/SectionCard";
import { TextInput } from "@/shared/ui/Input";
import { message } from "@/shared/ui/Message";
import { Modal } from "@/shared/ui/Modal";
import { Select } from "@/shared/ui/Select";
import Switch from "@/shared/ui/Switch";
import SettingsNotice from "../../components/SettingsNotice";
import SettingsPageLayout from "../../components/SettingsPageLayout";

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const initialFormState: PasswordFormState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

type ProxyFormState = {
  socks5Host: string;
  socks5Port: string;
  socks5Username: string;
  socks5Password: string;
};

const initialProxyFormState: ProxyFormState = {
  socks5Host: "",
  socks5Port: "",
  socks5Username: "",
  socks5Password: "",
};

function ChangePasswordModal({
  form,
  isSubmitting,
  errorMessage,
  successMessage,
  passwordMismatch,
  canSubmit,
  onChange,
  onSubmit,
  onReset,
}: {
  form: PasswordFormState;
  isSubmitting: boolean;
  errorMessage: string;
  successMessage: string;
  passwordMismatch: boolean;
  canSubmit: boolean;
  onChange: (next: Partial<PasswordFormState>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1">
        <p className="text-sm leading-6 text-text-secondary">
          {t("settings.general.password.description")}
        </p>
      </div>

      <TextInput
        label={t("settings.general.password.current")}
        type="password"
        value={form.currentPassword}
        onChange={(currentPassword) => onChange({ currentPassword })}
        placeholder={t("settings.general.password.currentPlaceholder")}
        disabled={isSubmitting}
      />

      <TextInput
        label={t("settings.general.password.next")}
        type="password"
        value={form.newPassword}
        onChange={(newPassword) => onChange({ newPassword })}
        placeholder={t("settings.general.password.nextPlaceholder")}
        disabled={isSubmitting}
      />

      <TextInput
        label={t("settings.general.password.confirm")}
        type="password"
        value={form.confirmPassword}
        onChange={(confirmPassword) => onChange({ confirmPassword })}
        placeholder={t("settings.general.password.confirmPlaceholder")}
        disabled={isSubmitting}
        error={
          passwordMismatch ? t("settings.general.password.mismatch") : undefined
        }
      />

      {form.currentPassword &&
      form.newPassword &&
      form.currentPassword === form.newPassword ? (
        <SettingsNotice tone="danger">
          {t("settings.general.password.sameAsCurrent")}
        </SettingsNotice>
      ) : null}

      {errorMessage ? (
        <SettingsNotice tone="danger">
          {errorMessage}
        </SettingsNotice>
      ) : null}

      {successMessage ? (
        <SettingsNotice
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
        >
          {successMessage}
        </SettingsNotice>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={isSubmitting}
        >
          {t("common.actions.reset")}
        </Button>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting
            ? t("settings.general.password.submitting")
            : t("settings.general.password.submit")}
        </Button>
      </div>
    </form>
  );
}

export default function General() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { language, setLanguage, supportedLanguages } =
    useLanguagePreferences();
  const { colorTheme, setColorTheme, themeMode, setThemeMode, themePresets } =
    useThemePreferences();
  const [form, setForm] = useState<PasswordFormState>(initialFormState);
  const [proxyForm, setProxyForm] = useState<ProxyFormState>(initialProxyFormState);
  const [savedProxyForm, setSavedProxyForm] =
    useState<ProxyFormState>(initialProxyFormState);
  const [proxyLoading, setProxyLoading] = useState(true);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyError, setProxyError] = useState("");
  const [proxySuccess, setProxySuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isCleaningConversations, setIsCleaningConversations] = useState(false);
  const themeMetadata = useMemo(
    () =>
      ({
        "warm-neutral": {
          label: t("settings.general.theme.presets.warm-neutral.label"),
          description: t(
            "settings.general.theme.presets.warm-neutral.description",
          ),
        },
        "knowledge-blue": {
          label: t("settings.general.theme.presets.knowledge-blue.label"),
          description: t(
            "settings.general.theme.presets.knowledge-blue.description",
          ),
        },
        "archive-green": {
          label: t("settings.general.theme.presets.archive-green.label"),
          description: t(
            "settings.general.theme.presets.archive-green.description",
          ),
        },
        "slate-ocean": {
          label: t("settings.general.theme.presets.slate-ocean.label"),
          description: t(
            "settings.general.theme.presets.slate-ocean.description",
          ),
        },
      }) satisfies Record<
        ThemePresetId,
        {
          label: string;
          description: string;
        }
      >,
    [t],
  );

  const passwordMismatch = useMemo(() => {
    if (!form.confirmPassword) {
      return false;
    }

    return form.newPassword !== form.confirmPassword;
  }, [form.confirmPassword, form.newPassword]);

  const canSubmit =
    form.currentPassword.trim().length > 0 &&
    form.newPassword.trim().length >= 6 &&
    form.confirmPassword.trim().length > 0 &&
    !passwordMismatch &&
    form.currentPassword !== form.newPassword;

  const proxyPortError = useMemo(() => {
    const value = proxyForm.socks5Port.trim();
    if (!value) {
      return "";
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return t("settings.general.proxy.portInvalid");
    }

    return "";
  }, [proxyForm.socks5Port, t]);

  const proxyIsDirty = useMemo(
    () =>
      proxyForm.socks5Host !== savedProxyForm.socks5Host ||
      proxyForm.socks5Port !== savedProxyForm.socks5Port ||
      proxyForm.socks5Username !== savedProxyForm.socks5Username ||
      proxyForm.socks5Password !== savedProxyForm.socks5Password,
    [proxyForm, savedProxyForm],
  );

  const canSaveProxy = !proxySaving && !proxyPortError && proxyIsDirty;

  useEffect(() => {
    void (async () => {
      try {
        setProxyLoading(true);
        const settings = await getGeneralSettings();
        const nextForm = {
          socks5Host: settings.socks5Host,
          socks5Port: settings.socks5Port > 0 ? String(settings.socks5Port) : "",
          socks5Username: settings.socks5Username,
          socks5Password: settings.socks5Password,
        };
        setProxyForm(nextForm);
        setSavedProxyForm(nextForm);
        setProxyError("");
      } catch (requestError) {
        if (requestError instanceof ApiError) {
          setProxyError(requestError.message);
        } else {
          setProxyError(t("settings.general.proxy.loadFailed"));
        }
      } finally {
        setProxyLoading(false);
      }
    })();
  }, [t]);

  const resetForm = () => {
    setForm(initialFormState);
    setErrorMessage("");
    setSuccessMessage("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!canSubmit) {
      setErrorMessage(t("settings.general.password.submitInvalid"));
      return;
    }

    setIsSubmitting(true);

    try {
      await changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });

      setForm(initialFormState);
      setSuccessMessage(t("settings.general.password.success"));
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setErrorMessage(requestError.message);
      } else {
        setErrorMessage(t("settings.general.password.failed"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const openPasswordModal = () => {
    Modal.show({
      title: t("settings.general.password.modalTitle"),
      width: 520,
      content: (
        <ChangePasswordModal
          form={form}
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          successMessage={successMessage}
          passwordMismatch={passwordMismatch}
          canSubmit={canSubmit}
          onChange={(next) => setForm((previous) => ({ ...previous, ...next }))}
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          onReset={resetForm}
        />
      ),
      footer: null,
      onClose: resetForm,
    });
  };

  const handleCleanupConversations = () => {
    Modal.confirm({
      title: t("settings.general.cleanup.title"),
      description: t("settings.general.cleanup.confirmDescription"),
      tone: "danger",
      confirmText: t("settings.general.cleanup.confirm"),
      cancelText: t("common.actions.cancel"),
      onConfirm: async () => {
        try {
          setIsCleaningConversations(true);
          const result = await cleanupThreads();
          const mediaFiles = Object.values(result.media).reduce(
            (total, summary) => total + summary.files,
            0,
          );
          const failedCleanups = result.failedThreads + result.failedWorkdirs;
          if (result.deletedThreads === 0 && failedCleanups === 0) {
            message.success(t("settings.general.cleanup.empty"));
            return;
          }
          message.success(
            t(
              failedCleanups > 0
                ? "settings.general.cleanup.partial"
                : "settings.general.cleanup.success",
              {
                threads: result.deletedThreads,
                messages: result.deletedMessages,
                failed: failedCleanups,
                logs: (result.clearedLogBytes / 1024).toFixed(1),
                media: mediaFiles,
              },
            ),
          );
          window.dispatchEvent(new Event("uichat:threads-cleaned"));
        } catch (requestError) {
          message.error(
            requestError instanceof ApiError
              ? requestError.message
              : t("settings.general.cleanup.failed"),
          );
        } finally {
          setIsCleaningConversations(false);
        }
      },
      onCancel: () => void 0,
    });
  };

  const handleProxyFieldChange = (patch: Partial<ProxyFormState>) => {
    setProxyForm((previous) => ({ ...previous, ...patch }));
    setProxyError("");
    setProxySuccess("");
  };

  const handleSaveProxy = async () => {
    if (proxyPortError) {
      setProxyError(proxyPortError);
      return;
    }

    const payload: BackendGeneralSettings = {
      socks5Host: proxyForm.socks5Host.trim(),
      socks5Port: proxyForm.socks5Port.trim()
        ? Number(proxyForm.socks5Port.trim())
        : 0,
      socks5Username: proxyForm.socks5Username.trim(),
      socks5Password: proxyForm.socks5Password,
    };

    setProxySaving(true);
    setProxyError("");
    setProxySuccess("");

    try {
      const saved = await updateGeneralSettings(payload);
      const nextForm = {
        socks5Host: saved.socks5Host,
        socks5Port: saved.socks5Port > 0 ? String(saved.socks5Port) : "",
        socks5Username: saved.socks5Username,
        socks5Password: saved.socks5Password,
      };
      setProxyForm(nextForm);
      setSavedProxyForm(nextForm);
      setProxySuccess(t("settings.general.proxy.saveSuccess"));
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setProxyError(requestError.message);
      } else {
        setProxyError(t("settings.general.proxy.saveFailed"));
      }
    } finally {
      setProxySaving(false);
    }
  };

  return (
    <SettingsPageLayout
      miniTitle={t("settings.general.page.miniTitle")}
      title={t("settings.general.page.title")}
      description={t("settings.general.page.description")}
      contentClassName="space-y-4 pt-6"
      contentMode="flow"
    >
      <SectionCard title={t("settings.general.preferences")} divided>
        <SectionCardRow>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text-primary">
                {session?.user.username ?? "-"}
              </span>
              <Badge variant="muted" className="capitalize">
                {session?.user.role ?? "-"}
              </Badge>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={openPasswordModal}>
            <KeyRound className="h-4 w-4" />
            {t("settings.general.account.changePassword")}
          </Button>
        </SectionCardRow>

        <SectionCardRow>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {t("settings.general.language.label")}
            </div>
          </div>
          <div className="w-full max-w-[168px] shrink-0">
            <Select
              value={language}
              onChange={(value) =>
                void setLanguage(value as "zh-CN" | "en-US")
              }
              options={supportedLanguages.map((value) => ({
                value,
                label: t(`settings.general.language.options.${value}`),
              }))}
              compact
            />
          </div>
        </SectionCardRow>

        <SectionCardRow>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {t("settings.general.theme.label")}
            </div>
            <div className="mt-0.5 text-xs leading-5 text-text-secondary">
              {themeMetadata[colorTheme]?.description}
            </div>
          </div>
          <div className="w-full max-w-[168px] shrink-0">
            <Select
              value={colorTheme}
              onChange={(value) => setColorTheme(value as ThemePresetId)}
              options={themePresets.map((theme) => ({
                value: theme.id,
                label: themeMetadata[theme.id].label,
              }))}
              compact
            />
          </div>
        </SectionCardRow>

        <SectionCardRow>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {t("settings.general.darkMode.label")}
            </div>
          </div>
          <Switch
            checked={themeMode === "dark"}
            onChange={() =>
              setThemeMode(themeMode === "dark" ? "light" : "dark")
            }
            ariaLabel={t("settings.general.darkMode.ariaLabel")}
          />
        </SectionCardRow>

        <SectionCardRow>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {t("settings.general.cleanup.label")}
            </div>
            <div className="mt-0.5 text-xs leading-5 text-text-secondary">
              {t("settings.general.cleanup.description")}
            </div>
          </div>
          <Button
            variant="danger-ghost"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={handleCleanupConversations}
            disabled={isCleaningConversations}
          >
            <Trash2 className="h-4 w-4" />
            {t("settings.general.cleanup.action")}
          </Button>
        </SectionCardRow>
      </SectionCard>

      <SectionCard
        title={t("settings.general.proxy.title")}
        contentClassName="space-y-3 p-4"
      >
        <p className="text-sm text-text-secondary">
          {t("settings.general.proxy.description")}
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label={t("settings.general.proxy.host")}
            value={proxyForm.socks5Host}
            onChange={(socks5Host) => handleProxyFieldChange({ socks5Host })}
            placeholder={t("settings.general.proxy.hostPlaceholder")}
            disabled={proxyLoading || proxySaving}
            compact
          />
          <TextInput
            label={t("settings.general.proxy.port")}
            value={proxyForm.socks5Port}
            onChange={(socks5Port) => handleProxyFieldChange({ socks5Port })}
            placeholder={t("settings.general.proxy.portPlaceholder")}
            disabled={proxyLoading || proxySaving}
            error={proxyPortError || undefined}
            compact
          />
          <TextInput
            label={t("settings.general.proxy.username")}
            value={proxyForm.socks5Username}
            onChange={(socks5Username) =>
              handleProxyFieldChange({ socks5Username })
            }
            placeholder={t("settings.general.proxy.usernamePlaceholder")}
            disabled={proxyLoading || proxySaving}
            compact
          />
          <TextInput
            label={t("settings.general.proxy.password")}
            type="password"
            value={proxyForm.socks5Password}
            onChange={(socks5Password) =>
              handleProxyFieldChange({ socks5Password })
            }
            placeholder={t("settings.general.proxy.passwordPlaceholder")}
            disabled={proxyLoading || proxySaving}
            compact
          />
        </div>

        {proxyError ? (
          <SettingsNotice tone="danger">{proxyError}</SettingsNotice>
        ) : null}

        {proxySuccess ? (
          <SettingsNotice
            tone="success"
            icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          >
            {proxySuccess}
          </SettingsNotice>
        ) : null}

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!canSaveProxy || proxyLoading}
            onClick={() => void handleSaveProxy()}
          >
            {proxySaving
              ? t("settings.general.proxy.saving")
              : t("settings.general.proxy.save")}
          </Button>
        </div>
      </SectionCard>
    </SettingsPageLayout>
  );
}
