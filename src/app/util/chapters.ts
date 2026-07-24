import { Chapter } from '../models';
import { Mp4Meta } from './mp4';
import { chapterTitle } from './format';

/**
 * Turn one audio file into a book's chapters.
 *
 * Shared by the Drive scanner and the local-file importer so a file behaves
 * identically wherever it came from:
 *   - No embedded markers → a single chapter spanning the whole file.
 *   - Embedded markers → one chapter per marker, expressed as `[start, end)`
 *     windows over the same file. A marker that starts after 0:00 gets an
 *     "Opening" chapter for the audio before it.
 */
export function buildFileChapters(
  fileId: string,
  name: string,
  mimeType: string | undefined,
  size: number | undefined,
  meta: Mp4Meta | null
): Chapter[] {
  const marks = meta?.chapters ?? [];

  if (!marks.length) {
    return [
      {
        id: fileId,
        fileId,
        name,
        title: chapterTitle(name),
        index: 0,
        mimeType,
        size,
        duration: meta?.duration || undefined,
        start: 0,
        end: meta?.duration || undefined,
      },
    ];
  }

  const points = marks[0].start > 1 ? [{ title: 'Opening', start: 0 }, ...marks] : marks;

  return points.map((mark, i) => {
    const start = i === 0 ? 0 : mark.start;
    const end = points[i + 1]?.start ?? meta?.duration ?? undefined;
    return {
      id: `${fileId}#${i}`,
      fileId,
      name,
      title: mark.title?.trim() || `Chapter ${i + 1}`,
      index: i,
      mimeType,
      size,
      duration: end != null ? Math.max(0, end - start) : undefined,
      start,
      end,
    };
  });
}
