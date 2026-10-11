import { BusinessOperation } from './BusinessSync';
export interface ReadingEntry { id: string; kind: string; text: string; location: string; }
export interface ReadingQuestion {
  id: string; bookId: string; entryId: string; text: string; needId: string; origin: string;
  sourceEntry: ReadingEntry; interactions: BusinessOperation[];
}
export interface ReadingCycle { id: string; state: string; operationId: string; }
export interface ReadingBook {
  id: string; title: string; progress: number | null; progressUnit: string; source: string;
  sourceUpdatedAt: number | null; updatedAt: number; entries: ReadingEntry[]; organized: string;
  questions: ReadingQuestion[]; cycles: ReadingCycle[];
}
export interface ReadingPolicy {
  enabled: boolean; bookIds: string[]; intervalHours: number; timezone: string; consent: boolean; nextAt?: number;
}
export interface ReadingCollection { id: string; state: string; error: string; created: number; }
export interface ReadingSnapshot { collections?: ReadingCollection[]; books: ReadingBook[]; policy: ReadingPolicy; sourceConfigured: boolean; }
export interface ReadingQuestionRequest { id: string; bookId: string; entryId: string; text: string; quote?: string; }
export interface ReadingAnswerRequest { questionId: string; operationId: string; input: string; }
export interface ReadingCollectRequest { cycleId: string; }
export function validateReadingSnapshot(snapshot: ReadingSnapshot): ReadingSnapshot {
  if (!snapshot || !Array.isArray(snapshot.books) || !snapshot.policy || !Array.isArray(snapshot.policy.bookIds)) {
    throw new Error('阅读副本无效');
  }
  snapshot.books.forEach((book: ReadingBook) => {
    if (!book.id || !book.title || !book.source || !Number.isFinite(book.updatedAt) || book.updatedAt <= 0 ||
      (book.progress !== null && (!Number.isInteger(book.progress) || book.progress < 0 || book.progress > 100)) ||
      book.progressUnit !== 'percent' || !Array.isArray(book.entries) || !Array.isArray(book.questions) ||
      !Array.isArray(book.cycles) || typeof book.organized !== 'string') { throw new Error('阅读来源无效'); }
    book.entries.forEach((entry: ReadingEntry) => {
      if (!entry.id || !['highlight', 'thought'].includes(entry.kind) || typeof entry.text !== 'string' ||
        typeof entry.location !== 'string') { throw new Error('笔记来源无效'); }
    });
    book.questions.forEach((question: ReadingQuestion) => {
      if (!question.id || question.bookId !== book.id || !question.sourceEntry || question.sourceEntry.id !== question.entryId ||
        question.origin !== 'user' || !question.needId || !question.text || !Array.isArray(question.interactions)) {
        throw new Error('疑问关联无效');
      }
    });
  });
  return snapshot;
}
