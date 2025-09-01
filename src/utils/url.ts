// src/utils/url.ts

/* Copyright (c) Connecting Solution & Applications Ltd. */
/* Apache License 2.0 */

/**
 * Join the base_url and path without adding extra slashes.
 * 
 * @param base_url - The base URL.
 * @param path - The path to be appended to the base URL.
 * @returns The safely joined URL.
 */
export function safelyJoinUrl(base_url: string, path: string): string {
    // Remove trailing slash from base_url if it exists
    if (base_url.endsWith('/')) {
        base_url = base_url.substring(0, base_url.length - 1);
    }
    // Remove leading slash from path if it exists
    if (path.startsWith('/')) {
        path = path.substring(1);
    }
    return `${base_url}/${path}`;
}

/**
 * Splits a given URL into its domain and path components.
 *
 * @param {string} urlString - The full URL string to be split.
 * @returns {{ domain: string; path: string }} An object containing the `domain` and `path` of the URL.
 * If the URL is not valid it returns empty domain and path.
 *
 * @example
 * Returns { domain: 'www.example.com', path: '/some/path' }
 * const result = splitUrl('https://www.example.com/some/path?query=string');
 *
 * @example
 * Returns null for invalid URLs
 * const result = splitUrl('invalid-url');
 */
export function splitUrl(urlString: string): { domain: string; path: string } | null {
    const domain = "";
    const path = "";
    try {
        const url = new URL(urlString);
        const domain = url.hostname;
        const path = url.pathname;
    } catch (error) {
        console.error("Invalid URL provided:", (error as any).message);
    }
    return { domain, path };
}
