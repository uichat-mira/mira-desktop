import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/Button";
import { TextArea, TextInput } from "@/shared/ui/Input";

interface KnowledgeBaseEditorFormProps {
  title: string;
  confirmLabel: string;
  initialName?: string;
  initialDescription?: string;
  initialPersona?: string;
  initialScenario?: string;
  initialTags?: string;
  onSubmit: (input: {
    name: string;
    description: string;
    persona: string;
    scenario: string;
    tags: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export default function KnowledgeBaseEditorForm({
  confirmLabel,
  initialName = "",
  initialDescription = "",
  initialPersona = "",
  initialScenario = "",
  initialTags = "",
  onSubmit,
  onCancel,
}: KnowledgeBaseEditorFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [persona, setPersona] = useState(initialPersona);
  const [scenario, setScenario] = useState(initialScenario);
  const [tags, setTags] = useState(initialTags);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <TextInput
          label={t("settings.knowledgeBase.editor.name")}
          value={name}
          onChange={setName}
          placeholder={t("settings.knowledgeBase.editor.namePlaceholder")}
          compact
        />
        <TextArea
          label={t("settings.knowledgeBase.editor.description")}
          value={description}
          onChange={setDescription}
          placeholder={t(
            "settings.knowledgeBase.editor.descriptionPlaceholder",
          )}
          compact
          rows={3}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={t("settings.knowledgeBase.editor.persona")}
            value={persona}
            onChange={setPersona}
            placeholder={t("settings.knowledgeBase.editor.personaPlaceholder")}
            compact
          />
          <TextInput
            label={t("settings.knowledgeBase.editor.scenario")}
            value={scenario}
            onChange={setScenario}
            placeholder={t("settings.knowledgeBase.editor.scenarioPlaceholder")}
            compact
          />
        </div>
        <TextInput
          label={t("settings.knowledgeBase.editor.tags")}
          value={tags}
          onChange={setTags}
          placeholder={t("settings.knowledgeBase.editor.tagsPlaceholder")}
          compact
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          {t("settings.knowledgeBase.editor.cancel")}
        </Button>
        <Button
          onClick={async () => {
            setSubmitting(true);
            try {
              await onSubmit({ name, description, persona, scenario, tags });
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
