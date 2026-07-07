/**
 * DailyMed SPL XML parser.
 *
 * Extracts structured sections from FDA Structured Product Labeling (SPL) XML
 * documents. SPL uses LOINC codes to identify standard sections (indications,
 * warnings, adverse reactions, etc.).
 *
 * See planning/22_clinical-data-gathering.md §5d.
 */

/**
 * LOINC codes for key SPL sections.
 * These are the most clinically relevant sections for caregiver decision support.
 */
const KEY_SECTION_CODES: Record<string, string> = {
  '34066-0': 'INDICATIONS & USAGE',
  '34068-5': 'DOSAGE & ADMINISTRATION',
  '34067-8': 'CONTRAINDICATIONS',
  '34067-9': 'WARNINGS AND PRECAUTIONS',
  '34068-7': 'ADVERSE REACTIONS',
  '34030-7': 'DRUG INTERACTIONS',
  '43684-0': 'CLINICAL PHARMACOLOGY',
  '42232-6': 'DESCRIPTION',
};

export interface SplSection {
  code: string;
  heading: string;
  text: string;
}

/**
 * Extract key sections from SPL XML.
 *
 * SPL XML structure:
 *   <document>
 *     <section>
 *       <code code="34067-9" codeSystem="2.16.840.1.113883.6.1"/>
 *       <title>Warnings</title>
 *       <text>...section content...</text>
 *     </section>
 *   </document>
 *
 * Returns a map of LOINC code → section content.
 */
export function extractSectionsFromSplXml(xml: string): Map<string, SplSection> {
  const sections = new Map<string, SplSection>();

  // Match <section> blocks
  const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
  let sectionMatch;

  while ((sectionMatch = sectionRegex.exec(xml)) !== null) {
    const sectionContent = sectionMatch[1];

    // Extract LOINC code from <code code="XXXXX" .../>
    const codeMatch = sectionContent.match(/<code[^>]+code="([^"]+)"/i);
    if (!codeMatch) continue;

    const code = codeMatch[1];
    const heading = KEY_SECTION_CODES[code];
    if (!heading) continue; // Skip sections we don't care about

    // Extract text content
    const textMatch = sectionContent.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
    if (!textMatch) continue;

    const rawText = textMatch[1];
    const cleanText = stripXmlTags(rawText).trim();

    if (cleanText.length < 50) continue; // Skip very short sections

    sections.set(code, {
      code,
      heading,
      text: cleanText,
    });
  }

  return sections;
}

/**
 * Strip XML/HTML tags and normalize whitespace.
 * Handles common SPL formatting: <paragraph>, <list>, <content>, etc.
 */
function stripXmlTags(xml: string): string {
  return xml
    // Convert common block elements to newlines
    .replace(/<\/?(paragraph|list|item|table|row|content)[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common XML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Build a consolidated drug label text from extracted sections.
 * Combines key sections in a clinically useful order.
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
    '34067-9', // Warnings and Precautions
    '34030-7', // Drug Interactions
    '34068-7', // Adverse Reactions
  ];

  for (const code of sectionOrder) {
    const section = sections.get(code);
    if (section) {
      lines.push(`${section.heading}:`);
      lines.push(section.text);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}
