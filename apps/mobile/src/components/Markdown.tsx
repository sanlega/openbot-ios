import { useMemo } from "react";
import { Text, View } from "react-native";
import { parseMarkdown, type Span } from "@/lib/markdown";
import { makeStyles, radius, space, type } from "@/theme";

export function Markdown({ text, color }: { text: string; color: string }) {
  const styles = useStyles();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const spans = (items: Span[]) =>
    items.map((span, index) => (
      <Text
        key={index}
        style={[
          span.bold && styles.bold,
          span.italic && styles.italic,
          span.code && styles.inlineCode,
        ]}
      >
        {span.text}
      </Text>
    ));
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <Text key={index} style={styles.codeBlock} selectable>
              {block.text}
            </Text>
          );
        }
        if (block.type === "bullet") {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={[styles.text, { color }]}>{block.marker}</Text>
              <Text style={[styles.text, styles.bulletText, { color }]} selectable>
                {spans(block.spans)}
              </Text>
            </View>
          );
        }
        return (
          <Text
            key={index}
            style={[styles.text, block.type === "heading" && styles.heading, { color }]}
            selectable
          >
            {spans(block.spans)}
          </Text>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { gap: 6 },
  text: { fontSize: type.body, lineHeight: 21 },
  heading: { fontWeight: "700", fontSize: type.headline },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  inlineCode: {
    fontFamily: "Menlo",
    fontSize: type.subhead,
    backgroundColor: "rgba(127, 127, 140, 0.22)",
  },
  codeBlock: {
    fontFamily: "Menlo",
    fontSize: type.footnote,
    lineHeight: 17,
    color: c.text,
    backgroundColor: c.background,
    borderRadius: radius.sm,
    padding: space[3],
    overflow: "hidden",
  },
  bulletRow: { flexDirection: "row", gap: space[2] },
  bulletText: { flexShrink: 1 },
}));
