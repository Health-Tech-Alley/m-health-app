import { StyleSheet } from 'react-native';
import { Markdown } from '@believer/react-native-markdown-display';
import { useTheme } from '@/hooks/use-theme';

type MarkdownRendererProps = {
  children: string;
  size?: 'normal' | 'large';
  /**
   * When true, the body / paragraph / list_item / heading / strong text is
   * rendered bold. Used by the streaming answer state in the chat tab so
   * the live answer reads as "bold answer text" while tokens arrive
   * (planning/32 §7.2).
   */
  bold?: boolean;
};

export function MarkdownRenderer({ children, size = 'normal', bold = false }: MarkdownRendererProps) {
  const theme = useTheme();
  const baseFontSize = size === 'large' ? 18 : 16;
  const headingScale = size === 'large' ? 1.2 : 1.0;
  const bodyWeight = bold ? '700' : '400';

  const styles = StyleSheet.create({
    body: {
      color: theme.text,
      fontSize: baseFontSize,
      fontWeight: bodyWeight,
    },
    heading1: {
      color: theme.text,
      fontSize: Math.round(24 * headingScale),
      fontWeight: '700',
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      color: theme.text,
      fontSize: Math.round(20 * headingScale),
      fontWeight: '700',
      marginTop: 14,
      marginBottom: 6,
    },
    heading3: {
      color: theme.text,
      fontSize: Math.round(18 * headingScale),
      fontWeight: '700',
      marginTop: 12,
      marginBottom: 4,
    },
    paragraph: {
      color: theme.text,
      fontSize: baseFontSize,
      fontWeight: bodyWeight,
      marginTop: 8,
      marginBottom: 8,
    },
    list_item: {
      color: theme.text,
      fontSize: baseFontSize,
      fontWeight: bodyWeight,
    },
    bullet_list: {
      color: theme.text,
    },
    ordered_list: {
      color: theme.text,
    },
    strong: {
      color: theme.text,
      fontWeight: '800',
    },
    em: {
      color: theme.text,
      fontStyle: 'italic',
    },
    code: {
      color: theme.text,
      backgroundColor: theme.backgroundElement,
      fontFamily: 'monospace',
      padding: 2,
    },
    blockquote: {
      backgroundColor: theme.backgroundElement,
      borderColor: theme.textSecondary,
      borderLeftWidth: 3,
      paddingLeft: 12,
      marginVertical: 8,
    },
    link: {
      color: '#3c87f7',
      textDecorationLine: 'underline',
    },
  });

  return (
    <Markdown style={styles}>
      {children}
    </Markdown>
  );
}
