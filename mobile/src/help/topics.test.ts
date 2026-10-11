import { ALL_HELP_TOPICS, HELP_TOPICS } from './topics';

describe('help topics', () => {
  // Rows and sections are keyed by term and title.
  it.each(ALL_HELP_TOPICS.map((topic) => [topic.title, topic] as const))(
    '%s has unique section titles and terms',
    (_title, topic) => {
      const sectionTitles = topic.sections.map((section) => section.title);
      expect(new Set(sectionTitles).size).toBe(sectionTitles.length);
      for (const section of topic.sections) {
        const terms = section.entries.map((entry) => entry.term);
        expect(new Set(terms).size).toBe(terms.length);
      }
    },
  );

  it('includes every tab topic in the full guide', () => {
    expect(ALL_HELP_TOPICS).toEqual(expect.arrayContaining(Object.values(HELP_TOPICS)));
  });
});
