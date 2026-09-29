import type { InputAnswer, InputField, InputRequest } from "@openbot/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useConnection } from "@/connection/ConnectionProvider";
import { missingRequired } from "@/lib/inputs";
import { relativeTime } from "@/lib/format";
import { useNamer } from "@/lib/queries";
import { makeStyles, radius, space, type, useTheme } from "@/theme";
import { BotAvatar, Button, Card, ErrorText, Icon } from "./ui";

export function InputCard({ input }: { input: InputRequest }) {
  const styles = useStyles();
  const { client } = useConnection();
  const queryClient = useQueryClient();
  const namer = useNamer();
  const bot = namer.get(input.botId);
  const [answers, setAnswers] = useState<Record<string, InputAnswer>>({});
  const set = (id: string, value: InputAnswer) =>
    setAnswers((previous) => ({ ...previous, [id]: value }));
  const done = () => queryClient.invalidateQueries({ queryKey: ["openbot"] });
  const submit = useMutation({
    mutationFn: () => client!.answerInput(input.id, answers),
    onSettled: done,
  });
  const dismiss = useMutation({
    mutationFn: () => client!.dismissInput(input.id),
    onSettled: done,
  });
  const missing = missingRequired(input.fields, answers);
  const busy = submit.isPending || dismiss.isPending;

  return (
    <Card tone="accent">
      <View style={styles.head}>
        {bot ? <BotAvatar bot={bot} size={30} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.who}>{namer.name(input.botId)} asks</Text>
          <Text style={styles.when}>{relativeTime(input.createdAt)}</Text>
        </View>
      </View>
      <Text style={styles.title}>{input.title}</Text>
      {input.intro ? <Text style={styles.intro}>{input.intro}</Text> : null}
      {input.fields.map((field) => (
        <Field
          key={field.id}
          field={field}
          value={answers[field.id]}
          onChange={(v) => set(field.id, v)}
        />
      ))}
      <ErrorText error={submit.error ?? dismiss.error} />
      <View style={styles.actions}>
        <Button
          label="Skip"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={busy}
          loading={dismiss.isPending}
          onPress={() => dismiss.mutate()}
        />
        <Button
          label="Send"
          icon="paperplane.fill"
          style={{ flex: 1 }}
          disabled={busy || missing.length > 0}
          loading={submit.isPending}
          onPress={() => submit.mutate()}
        />
      </View>
    </Card>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: InputField;
  value: InputAnswer | undefined;
  onChange(value: InputAnswer): void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const label = (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{field.label}</Text>
      {!field.required ? <Text style={styles.optional}>Optional</Text> : null}
    </View>
  );
  const help = field.help ? <Text style={styles.help}>{field.help}</Text> : null;

  if (field.type === "choice") {
    const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const toggle = (option: string) => {
      if (!field.multiple) return onChange(option);
      onChange(
        selected.includes(option)
          ? selected.filter((item) => item !== option)
          : [...selected, option],
      );
    };
    return (
      <View style={styles.field}>
        {label}
        {help}
        <View style={styles.choices}>
          {field.options.map((option) => {
            const on = selected.includes(option);
            return (
              <Pressable
                key={option}
                onPress={() => toggle(option)}
                accessibilityRole={field.multiple ? "checkbox" : "radio"}
                accessibilityState={{ checked: on }}
                style={[styles.choice, on && styles.choiceOn]}
              >
                {on ? (
                  <Icon name="checkmark" size={12} color={colors.accent} weight="bold" />
                ) : null}
                <Text style={[styles.choiceText, on && { color: colors.accent }]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (field.type === "confirm") {
    return (
      <View style={styles.field}>
        {label}
        {help}
        <View style={styles.segmented}>
          {(["Yes", "No"] as const).map((option) => {
            const on = value === (option === "Yes");
            return (
              <Pressable
                key={option}
                onPress={() => onChange(option === "Yes")}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={[styles.segment, on && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, on && { color: colors.text }]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return (
    <View style={styles.field}>
      {label}
      {help}
      <TextInput
        value={text}
        onChangeText={(next) =>
          onChange(field.type === "number" ? (next.trim() === "" ? null : Number(next)) : next)
        }
        placeholder={
          field.type === "text"
            ? field.placeholder
            : field.type === "date"
              ? "YYYY-MM-DD"
              : field.type === "secret"
                ? "Stored in your desktop's vault"
                : undefined
        }
        placeholderTextColor={colors.subtle}
        keyboardType={field.type === "number" ? "decimal-pad" : "default"}
        secureTextEntry={field.type === "secret"}
        multiline={field.type === "text" && field.multiline}
        autoCapitalize={field.type === "text" ? "sentences" : "none"}
        style={[styles.input, field.type === "text" && field.multiline && { minHeight: 88 }]}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  who: { color: c.text, fontSize: type.subhead, fontWeight: "600" },
  when: { color: c.subtle, fontSize: type.caption, marginTop: 1 },
  title: { color: c.text, fontSize: type.headline + 1, fontWeight: "700" },
  intro: { color: c.muted, fontSize: type.subhead + 1, lineHeight: 20 },
  field: { gap: space[2] },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  label: { color: c.text, fontSize: type.subhead + 1, fontWeight: "600", flexShrink: 1 },
  optional: { color: c.subtle, fontSize: type.caption },
  help: { color: c.muted, fontSize: type.footnote, lineHeight: 17 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space[3],
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceRaised,
  },
  choiceOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  choiceText: { color: c.text, fontSize: type.subhead + 1, fontWeight: "500" },
  segmented: {
    flexDirection: "row",
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.sm + 2,
    padding: 3,
  },
  segment: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radius.sm },
  segmentOn: { backgroundColor: c.surfaceHigh },
  segmentText: { color: c.muted, fontSize: type.subhead + 1, fontWeight: "600" },
  input: {
    color: c.text,
    backgroundColor: c.surfaceRaised,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: 11,
    fontSize: type.body,
  },
  actions: { flexDirection: "row", gap: space[2] },
}));
