import { useState } from "react";
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
          label="知识库名称"
          value={name}
          onChange={setName}
          placeholder="例如：产后康复指南"
          compact
        />
        <TextArea
          label="描述"
          value={description}
          onChange={setDescription}
          placeholder="可选"
          compact
          rows={3}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="人格"
            value={persona}
            onChange={setPersona}
            placeholder="例如：医生"
            compact
          />
          <TextInput
            label="场景"
            value={scenario}
            onChange={setScenario}
            placeholder="例如：门诊问答"
            compact
          />
        </div>
        <TextInput
          label="标签"
          value={tags}
          onChange={setTags}
          placeholder="逗号分隔，例如：医学,康复,指南"
          compact
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          取消
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
