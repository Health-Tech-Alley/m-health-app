/**
 * DailyMed SPL XML parser.
 *
 * Extracts structured sections from FDA Structured Product Labeling (SPL) XML
 * documents. SPL uses LOINC codes to identify standard sections (indications,
 * warnings, adverse reactions, etc.).
 *
 * Handles the actual DailyMed XML structure which uses nested <component><section>
 * and has many 42229-5 (SPL UNCLASSIFIED) subsections.
 */

/** LOINC → friendly heading for known sections. */
const KNOWN_SECTION_HEADINGS: Record<string, string> = {
  '34066-0': 'Indications & Usage',
  '34068-5': 'Dosage & Administration',
  '34067-8': 'Contraindications',
  '34067-9': 'Warnings',
  '34068-7': 'Dosage & Administration',
  '34070-3': 'Contraindications',
  '34071-1': 'Warnings',
  '34084-4': 'Adverse Reactions',
  '34088-5': 'Overdosage',
  '34069-5': 'How Supplied',
  '34090-1': 'Clinical Pharmacology',
  '42232-6': 'Description',
  '42232-9': 'Precautions',
  '34030-7': 'Drug Interactions',
  '34072-8': 'Clinical Studies',
  '42227-9': 'Drug Abuse and Dependence',
  '42231-8': 'Pharmacokinetics',
  '43678-2': 'Dosage Forms & Strengths',
  '44425-7': 'Storage and Handling',
  '60559-2': 'Patient Medication Information',
  '42229-5': 'Section',
};

/** Codes that carry useful clinical text (skip package/display junk). */
const SKIP_CODES = new Set(['51945-4', '48780-1']);

export interface SplSection {
  code: string;
  heading: string;
  text: string;
}

/**
 * Extract sections from SPL XML.
 *
 * Real DailyMed XML has:
 *   <component><section><code code="..."/><title>...</title><text>...</text></section></component>
 * Nested sections are rare; subsections use <component><section> too.
 */
export function extractSectionsFromSplXml(xml: string): Map<string, SplSection> {
  const sections = new Map<string, SplSection>();

  // Match each <section> block. Use non-greedy so nested <component> doesn't swallow siblings.
  const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = sectionRegex.exec(xml)) !== null) {
    const body = match[1];

    const codeMatch = body.match(/<code[^>]+code="([^"]+)"/i);
    const code = codeMatch?.[1] ?? `UNK-${index}`;
    if (SKIP_CODES.has(code)) {
      index++;
      continue;
    }

    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch?.[1] ?? '';
    const title = stripXmlTags(rawTitle).trim();

    const textMatch = body.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
    const rawText = textMatch?.[1] ?? '';
    const text = stripXmlTags(rawText).trim();
    if (text.length < 50) {
      index++;
      continue;
    }

    const heading =
      title || KNOWN_SECTION_HEADINGS[code] || KNOWN_SECTION_HEADINGS[code.split('-')[0]] || `Section ${code}`;

    // Dedupe: later section with same code+heading wins (labels usually one per setid).
    const key = `${code}::${heading}`;
    sections.set(key, {
      code,
      heading,
      text,
    });
    index++;
  }

  return sections;
}

/**
 * Strip XML/HTML tags and normalize whitespace.
 * Handles common SPL formatting: <paragraph>, <list>, <content>, etc.
 */
function stripXmlTags(xml: string): string {
  return xml
    .replace(/<\/?(paragraph|list|item|table|row|content)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Build a consolidated drug label text from extracted sections.
 */
export function buildDrugLabelText(
  title: string,
  sections: Map<string, SplSection>,
): string {
  const lines: string[] = [title, ''];

  // Order: Description → Indications → Dosage → Contraindications → Warnings → Interactions → Adverse
  const sectionOrder = [
    '42232-6', // Description
    '34066-0', // Indications & Usage
    '34068-5', // Dosage & Administration
    '34067-8', // Contraindications
    '34067-9', // Warnings
    '34071-1', // Warnings
    '34030-7', // Drug Interactions
    '34084-4', // Adverse Reactions
    '34068-7', // Adverse Reactions
  ];

  const seen = new Set<string>();
  for (const code of sectionOrder) {
    const section = sections.get(code);
    if (section && !seen.has(section.heading)) {
      lines.push(`${section.heading}:`);
      lines.push(section.text);
      lines.push('');
      seen.add(section.heading);
    }
  }

  return lines.join('\n').trim();
}
