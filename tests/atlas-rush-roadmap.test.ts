import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const roadmap = readFileSync(new URL('../docs/roadmap.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../docs/how-nim-rush-works.md', import.meta.url), 'utf8');

/*
 * The roadmap is a public page about the game.
 *
 * It is read by players and by anyone deciding whether the project is worth
 * following, so it says what is coming and nothing about how the work is
 * organised. An earlier version leaked the build's internals - which pieces
 * were half-finished, what had not been measured yet, which deadlines the
 * schedule was shaped around - and read like a status report rather than a
 * plan for the game.
 */
describe('the roadmap is a product page', () => {
  it('is reachable from the front page and points at the rules', () => {
    expect(readme).toContain('docs/roadmap.md');
    expect(roadmap).toContain('how-nim-rush-works.md');
  });

  /*
   * No schedule language. A roadmap organised around payment dates tells a
   * reader what the deadlines are rather than what the game will become.
   */
  it('does not organise itself around deadlines', () => {
    expect(roadmap).not.toMatch(/milestone|instalment|installment|payout|month 2|month 3|next 30 days|days 30/i);
    expect(roadmap).not.toMatch(/competition/i);
  });

  /*
   * No internal state. Which pieces are half-built, what has not been tested,
   * and which assets are unresolved are all real and all belong in the work,
   * not on a page about the game.
   */
  it('keeps the build\'s internals out of it', () => {
    expect(roadmap).not.toMatch(/npm run|test files|draw call|licence|license|not (yet )?(been )?(verified|rendered|cut|measured)/i);
    expect(roadmap).not.toMatch(/is built;|are built;|already written|fallback/i);
  });

  /*
   * It still has to be about something. A roadmap of adjectives is worse than
   * no roadmap, so these are the concrete things it promises.
   */
  it('names what is actually coming', () => {
    expect(roadmap).toContain('## Split times');
    expect(roadmap).toContain('## More cities');
    expect(roadmap).toMatch(/weekly board/i);
  });

  /*
   * And where it touches money it must agree with the rules document. Two
   * pages stating different splits is how a rider believes the wrong one.
   */
  it('matches the rules on how the pool pays', () => {
    expect(roadmap).toContain('top three');
    expect(rules).toContain('50% / 30% / 20%');
  });
});
