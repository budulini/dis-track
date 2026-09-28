/** Fisher–Yates changes only the provided upcoming queue, retaining every entry. */
export function shuffleInPlace<T>(items: T[], random = Math.random): void {
    for (let index = items.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [items[index], items[other]] = [items[other], items[index]];
    }
}

export function pageItems<T>(items: T[], offset: number, limit: number) {
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50;
    const boundedOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    return { offset: boundedOffset, limit: boundedLimit, hasMore: boundedOffset + boundedLimit < items.length,
        tracks: items.slice(boundedOffset, boundedOffset + boundedLimit) };
}
