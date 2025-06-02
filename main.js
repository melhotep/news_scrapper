/**
 * Universal News Scraper Actor with Anti-Blocking Measures and Enhanced Extraction
 * 
 * This actor scrapes news items from various dynamic news sites,
 * automatically detecting and extracting title, link, date, and summary.
 * Includes proxy rotation, user-agent rotation, and strict post-filtering.
 * Special handling for alarabiya.net, aps.dz, and other complex news sites.
 */

const { Actor } = require("apify");
const { PlaywrightCrawler, Dataset } = require("crawlee");

// Initialize the Actor
Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    console.log("Input:", input);

    if (!input || !input.url) {
        throw new Error("Input must contain a \"url\" field!");
    }

    const { url, maxItems = 0, waitTime = 30 } = input;
    console.log(`Starting universal news scraper for URL: ${url}`);
    console.log(`Maximum items to extract: ${maxItems || "unlimited"}`);
    console.log(`Wait time for dynamic content: ${waitTime} seconds`);

    // Initialize the dataset to store results
    const dataset = await Dataset.open();
    let extractedCount = 0;
    let methodsUsed = new Set();

    // List of user agents to rotate
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59",
    ];

    // Create a PlaywrightCrawler instance
    const crawler = new PlaywrightCrawler({
        // Use headless browser for production
        launchContext: {
            launchOptions: {
                headless: true,
            },
        },
        // Add proxy configuration to avoid blocking
        proxyConfiguration: await Actor.createProxyConfiguration({
            groups: ["RESIDENTIAL"], // Use residential proxies to appear as regular users
        }),
        // Maximum time for each page
        navigationTimeoutSecs: 120,
        // Handler for each page
        async requestHandler({ page, request, log }) {
            log.info(`Processing ${request.url}...`);

            // Set a random user agent
            const randomUserAgent =
                userAgents[Math.floor(Math.random() * userAgents.length)];
            await page.setExtraHTTPHeaders({
                "User-Agent": randomUserAgent,
                "Accept-Language": "en-US,en;q=0.9",
                Accept:
                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                Connection: "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Cache-Control": "max-age=0",
            });

            // Wait for the page to load
            await page.waitForLoadState("domcontentloaded");
            log.info("Page DOM content loaded");

            // Check if we are blocked or access is denied
            const pageContent = await page.content();
            if (
                pageContent.includes("ACCESS DENIED") ||
                pageContent.includes("CAPTCHA") ||
                pageContent.includes("blocked") ||
                pageContent.includes("banned") ||
                pageContent.includes("security check")
            ) {
                log.error(
                    "Access denied or blocked by the website. Trying with a different proxy..."
                );

                // Save the blocked page for debugging
                await Actor.setValue("blocked_page", pageContent);
                await Actor.setValue(
                    "blocked_screenshot",
                    await page.screenshot(),
                    { contentType: "image/png" }
                );

                // Throw an error to trigger retry with a different proxy
                throw new Error("Access denied or blocked by the website");
            }

            // Wait additional time for dynamic content to load
            log.info(`Waiting ${waitTime} seconds for dynamic content...`);
            await page.waitForTimeout(waitTime * 1000);
            log.info("Wait completed");

            // Save a screenshot for debugging
            await Actor.setValue("screenshot", await page.screenshot(), {
                contentType: "image/png",
            });
            log.info("Screenshot saved");

            // Save HTML content for debugging
            await Actor.setValue("html", await page.content());
            log.info("HTML content saved");

            // Special handling for alarabiya.net
            if (request.url.includes("alarabiya.net")) {
                try {
                    // Extract articles using a specialized method for alarabiya.net
                    const articles = await extractAlarabiyaArticlesDirectly(
                        page,
                        log
                    );

                    if (articles.length > 0) {
                        log.info(
                            `Extracted ${articles.length} articles from alarabiya.net`
                        );

                        // Process and store the extracted articles
                        for (const article of articles) {
                            // Skip if we have reached the maximum number of items
                            if (maxItems > 0 && extractedCount >= maxItems) {
                                log.info(
                                    `Reached maximum number of items (${maxItems}), stopping extraction`
                                );
                                break;
                            }

                            // Add extraction method to the set
                            methodsUsed.add("alarabiya-specialized");

                            // Push the article to the dataset
                            await dataset.pushData(article);
                            extractedCount++;
                        }

                        return;
                    } else {
                        log.info(
                            "No articles found with specialized method, falling back to general extraction"
                        );
                    }
                } catch (error) {
                    log.error(
                        `Error during specialized extraction for alarabiya.net: ${error.message}`
                    );
                    log.info("Falling back to general extraction method");
                }
            }

            // Special handling for aps.dz
            if (request.url.includes("aps.dz")) {
                try {
                    // Extract articles using a specialized method for aps.dz
                    const articles = await extractApsDzArticlesDirectly(page, log);

                    if (articles.length > 0) {
                        log.info(`Extracted ${articles.length} articles from aps.dz`);

                        // Process and store the extracted articles
                        for (const article of articles) {
                            // Skip if we have reached the maximum number of items
                            if (maxItems > 0 && extractedCount >= maxItems) {
                                log.info(
                                    `Reached maximum number of items (${maxItems}), stopping extraction`
                                );
                                break;
                            }

                            // Add extraction method to the set
                            methodsUsed.add("apsdz-specialized");

                            // Push the article to the dataset
                            await dataset.pushData(article);
                            extractedCount++;
                        }

                        return;
                    } else {
                        log.info(
                            "No articles found with specialized method for aps.dz, falling back to general extraction"
                        );
                    }
                } catch (error) {
                    log.error(
                        `Error during specialized extraction for aps.dz: ${error.message}`
                    );
                    log.info("Falling back to general extraction method for aps.dz");
                }
            }

            // Extract articles using multiple approaches directly in browser context
            try {
                const articleElements = await page.evaluate((pageUrl) => {
                    // Helper function to clean text (remove extra whitespace, newlines)
                    const cleanText = (text) => {
                        if (!text) return "";
                        return text.replace(/\s+/g, " ").trim();
                    };

                    // Helper function to check if a link is likely a news article
                    const isNewsArticleLink = (href) => {
                        if (!href) return false;

                        // Skip navigation, social, and utility links
                        const skipPatterns = [
                            "/about",
                            "/contact",
                            "/privacy",
                            "/terms",
                            "/login",
                            "/register",
                            "/subscribe",
                            "/newsletter",
                            "/rss",
                            "/feed",
                            "/search",
                            "facebook.com",
                            "twitter.com",
                            "instagram.com",
                            "linkedin.com",
                            "youtube.com",
                            "pinterest.com",
                            "whatsapp",
                            "telegram",
                            "#",
                            "javascript:",
                            "mailto:",
                            "tel:",
                        ];

                        for (const pattern of skipPatterns) {
                            if (href.includes(pattern)) return false;
                        }

                        // Check if it is a root/home page
                        try {
                            const urlObj = new URL(href);
                            if (urlObj.pathname === "/" || urlObj.pathname === "")
                                return false;
                        } catch (e) {
                            // If URL parsing fails, just continue
                            console.log("URL parsing failed for: " + href);
                        }

                        return true;
                    };

                    // APPROACH 1: Find all potential article elements in the main content area
                    const allArticleLikeElements = Array.from(
                        document.querySelectorAll(
                            "article, div > h2, div > h3, .search-result, .result-item, .news-item, [class*=\"article\"], [class*=\"post\"], [class*=\"story\"], [class*=\"entry\"], [class*=\"item\"], [class*=\"result\"]"
                        )
                    ).filter((el) => {
                        // Basic filtering to ensure it is likely an article
                        return (
                            el.textContent.trim().length > 100 &&
                            el.querySelector("a") !== null
                        );
                    });

                    // APPROACH 2: Find all links with substantial text that might be article titles
                    const substantialLinks = Array.from(
                        document.querySelectorAll("a")
                    )
                        .filter((link) => {
                            // Check if the link has substantial text (likely a title)
                            const hasSubstantialText =
                                link.textContent.trim().length > 30;

                            // Check if it is not in navigation, header, or footer
                            const notInNavigation =
                                !link.closest(
                                    "nav, [role=\"navigation\"], header, footer, [class*=\"menu\"], [class*=\"nav\"]"
                                );

                            // Check if it is not just an image link
                            const notJustImage = link.textContent.trim().length > 0;

                            // Check if it is likely a news article link
                            const isNewsLink = isNewsArticleLink(link.href);

                            return (
                                hasSubstantialText &&
                                notInNavigation &&
                                notJustImage &&
                                isNewsLink
                            );
                        })
                        .map((link) => {
                            // Get the parent container that might contain date and summary
                            let container = link;
                            let depth = 0;

                            // Go up the DOM tree to find a container with more content
                            while (depth < 5 && container.parentElement) {
                                container = container.parentElement;

                                // If we found a container with substantial content, use it
                                if (
                                    container.textContent.trim().length > 150 ||
                                    container.querySelectorAll("p, span, div")
                                        .length > 2
                                ) {
                                    break;
                                }
                                depth++;
                            }

                            return container;
                        });

                    // APPROACH 3: Special case for flat search results (like africanreview.com)
                    // Look for h3 elements with links that are likely search results
                    const flatSearchResults = Array.from(
                        document.querySelectorAll(
                            "h1 > a, h2 > a, h3 > a, h4 > a, h5 > a, h6 > a, h1 a, h2 a, h3 a, h4 a, h5 a, h6 a"
                        )
                    )
                        .filter((link) => isNewsArticleLink(link.href))
                        .map((link) => {
                            // Get the heading element
                            const heading = link.closest(
                                "h1, h2, h3, h4, h5, h6"
                            );
                            if (!heading) return null;

                            // Get the parent container that might contain date and summary
                            let container = heading.parentElement;
                            let depth = 0;

                            // Go up the DOM tree to find a container with more content
                            while (
                                depth < 3 &&
                                container &&
                                container.parentElement
                            ) {
                                // If we found a container with substantial content, use it
                                if (
                                    container.textContent.trim().length > 150 ||
                                    container.querySelectorAll("p, span, div")
                                        .length > 2
                                ) {
                                    break;
                                }
                                container = container.parentElement;
                                depth++;
                            }

                            return container;
                        })
                        .filter((el) => el && el.textContent.trim().length > 100);

                    // APPROACH 4: Special case for table-based search results (like ahram.org.eg)
                    const tableSearchResults = Array.from(
                        document.querySelectorAll("table tr, tbody tr")
                    ).filter((tr) => {
                        // Check if the row has a title and content
                        return (
                            (tr.querySelector(
                                "h1 a, h2 a, h3 a, h4 a, h5 a, h6 a, h1 > a, h2 > a, h3 > a, h4 > a, h5 > a, h6 > a"
                            ) !== null ||
                                tr.querySelector("a") !== null) &&
                            tr.textContent.trim().length > 100
                        );
                    });

                    // APPROACH 5: Special case for card-based search results
                    const cardSearchResults = [];

                    // Method 1: Look for card-like containers with titles
                    const cardContainers = Array.from(
                        document.querySelectorAll(
                            ".card, [class*=\"card\"], [class*=\"article\"], [class*=\"post\"], [class*=\"item\"], [class*=\"story\"], [class*=\"entry\"]"
                        )
                    );
                    for (const card of cardContainers) {
                        if (
                            card.textContent.trim().length > 100 &&
                            card.querySelector("a") &&
                            !card.textContent.includes("cookies") &&
                            !card.textContent.includes("Accept")
                        ) {
                            cardSearchResults.push(card);
                        }
                    }

                    // APPROACH 6: Special case for AP News style results
                    const apNewsResults = Array.from(
                        document.querySelectorAll("[data-key], [data-id]")
                    ).filter((el) => {
                        return (
                            el.textContent.trim().length > 100 &&
                            el.querySelector("a") !== null
                        );
                    });

                    // APPROACH 7: Special case for Argus Media style results
                    const argusResults = Array.from(
                        document.querySelectorAll(
                            ".search-result, .result, [class*=\"search-result\"], [class*=\"search_result\"]"
                        )
                    ).filter((el) => {
                        return (
                            el.textContent.trim().length > 100 &&
                            el.querySelector("a") !== null
                        );
                    });

                    // APPROACH 8: Special case for Al-Monitor style results
                    const alMonitorResults = Array.from(
                        document.querySelectorAll("h1, h2, h3, h4, h5, h6")
                    )
                        .filter((heading) => {
                            return (
                                heading.querySelector("a") !== null &&
                                heading.textContent.trim().length > 20
                            );
                        })
                        .map((heading) => {
                            // Get the parent container
                            let container = heading.parentElement;
                            let depth = 0;

                            // Go up the DOM tree to find a container with more content
                            while (
                                depth < 3 &&
                                container &&
                                container.parentElement
                            ) {
                                // If we found a container with substantial content, use it
                                if (
                                    container.textContent.trim().length > 150 ||
                                    container.querySelectorAll("p, span, div")
                                        .length > 1
                                ) {
                                    break;
                                }
                                container = container.parentElement;
                                depth++;
                            }

                            return container;
                        });

                    // Combine all potential article elements
                    const combinedElements = [
                        ...allArticleLikeElements,
                        ...substantialLinks,
                        ...flatSearchResults,
                        ...tableSearchResults,
                        ...cardSearchResults,
                        ...apNewsResults,
                        ...argusResults,
                        ...alMonitorResults,
                    ].filter(Boolean); // Filter out any null/undefined elements

                    // Extract data from each potential article
                    const results = [];

                    // Process the elements
                    for (const element of combinedElements) {
                        // Extract title
                        let title = null;
                        let titleElement = null;

                        // Try to find title in headings
                        const headings = element.querySelectorAll(
                            "h1, h2, h3, h4, h5, h6"
                        );
                        if (headings.length > 0) {
                            titleElement = headings[0];
                            title = cleanText(titleElement.textContent);
                        }

                        // If no heading, try links with title-like classes
                        if (!title) {
                            const titleLinks = element.querySelectorAll(
                                "a[class*=\"title\"], a[class*=\"headline\"], a[class*=\"heading\"]"
                            );
                            if (titleLinks.length > 0) {
                                titleElement = titleLinks[0];
                                title = cleanText(titleLinks[0].textContent);
                            }
                        }

                        // If still no title, try any link with substantial text
                        if (!title) {
                            const links = Array.from(
                                element.querySelectorAll("a")
                            ).filter(
                                (a) =>
                                    a.textContent.trim().length > 20 &&
                                    isNewsArticleLink(a.href)
                            );

                            if (links.length > 0) {
                                titleElement = links[0];
                                title = cleanText(links[0].textContent);
                            }
                        }

                        // If still no title, try any link
                        if (!title) {
                            const links = Array.from(
                                element.querySelectorAll("a")
                            ).filter((a) => isNewsArticleLink(a.href));

                            if (links.length > 0) {
                                titleElement = links[0];
                                title = cleanText(links[0].textContent);
                            }
                        }

                        // Extract link
                        let link = null;

                        // If title element is or contains an anchor, use its href
                        if (titleElement) {
                            if (titleElement.tagName === "A") {
                                link = titleElement.href;
                            } else {
                                const anchorInTitle =
                                    titleElement.querySelector("a");
                                if (anchorInTitle) {
                                    link = anchorInTitle.href;
                                }
                            }
                        }

                        // If no link found yet, try other links
                        if (!link) {
                            const links = Array.from(
                                element.querySelectorAll("a")
                            ).filter((a) => isNewsArticleLink(a.href));

                            if (links.length > 0) {
                                link = links[0].href;
                            }
                        }

                        // Extract date
                        let date = null;

                        // Try time elements
                        const timeElements = element.querySelectorAll(
                            "time, [datetime]"
                        );
                        if (timeElements.length > 0) {
                            const timeEl = timeElements[0];
                            date =
                                timeEl.getAttribute("datetime") ||
                                cleanText(timeEl.textContent);
                        }

                        // Try elements with date-like classes
                        if (!date) {
                            const dateElements = element.querySelectorAll(
                                "[class*=\"date\"], [class*=\"time\"], [class*=\"published\"], [class*=\"meta\"]"
                            );
                            if (dateElements.length > 0) {
                                date = cleanText(dateElements[0].textContent);
                            }
                        }

                        // Try to find date in span elements
                        if (!date) {
                            const spans = element.querySelectorAll("span");
                            for (const span of spans) {
                                const text = span.textContent.trim();
                                // Check for date patterns like MM/DD/YYYY or DD/MM/YYYY
                                if (
                                    /\d{1,2}\/\d{1,2}\/\d{4}/.test(text) ||
                                    /\d{1,2}-\d{1,2}-\d{4}/.test(text) ||
                                    /\d{1,2}\.\d{1,2}\.\d{4}/.test(text)
                                ) {
                                    date = cleanText(text);
                                    break;
                                }

                                // Check for date patterns like "25 October 2010" or "18 April 2022"
                                const dateMatch = text.match(
                                    /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i
                                );
                                if (dateMatch) {
                                    date = cleanText(text);
                                    break;
                                }

                                // Check for time patterns like "11:19:08 PM"
                                if (
                                    /\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)/.test(
                                        text
                                    )
                                ) {
                                    date = cleanText(text);
                                    break;
                                }

                                // Check for "X days ago" pattern
                                if (/\d+\s+days?\s+ago/.test(text)) {
                                    date = cleanText(text);
                                    break;
                                }

                                // Check for month and year pattern (e.g., "13 May 2025")
                                if (
                                    /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(
                                        text
                                    )
                                ) {
                                    date = cleanText(text);
                                    break;
                                }

                                // Check for year only (e.g., "2025")
                                if (/^20\d{2}$/.test(text)) {
                                    date = cleanText(text);
                                    break;
                                }
                            }
                        }

                        // Try to find date in div elements
                        if (!date) {
                            const divs = element.querySelectorAll("div");
                            for (const div of divs) {
                                const text = div.textContent.trim();
                                // Skip if too long to be a date
                                if (text.length > 30) continue;

                                // Check for date patterns
                                if (
                                    /\d{1,2}\/\d{1,2}\/\d{4}/.test(text) ||
                                    /\d{1,2}-\d{1,2}-\d{4}/.test(text) ||
                                    /\d{1,2}\.\d{1,2}\.\d{4}/.test(text) ||
                                    /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i.test(
                                        text
                                    ) ||
                                    /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(
                                        text
                                    ) ||
                                    /\d+\s+days?\s+ago/.test(text)
                                ) {
                                    date = cleanText(text);
                                    break;
                                }
                            }
                        }

                        // Try to find date in text content (common pattern: DD Month YYYY)
                        if (!date) {
                            // Get all text nodes directly under the element
                            const textNodes = Array.from(element.childNodes)
                                .filter(
                                    (node) => node.nodeType === Node.TEXT_NODE
                                )
                                .map((node) => node.textContent.trim())
                                .filter((text) => text.length > 0);

                            // Look for date patterns in text nodes
                            for (const text of textNodes) {
                                // Match patterns like "25 October 2010" or "18 April 2022"
                                const dateMatch = text.match(
                                    /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i
                                );
                                if (dateMatch) {
                                    date = cleanText(dateMatch[0]);
                                    break;
                                }

                                // Match patterns like "13 May 2025"
                                const shortDateMatch = text.match(
                                    /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i
                                );
                                if (shortDateMatch) {
                                    date = cleanText(shortDateMatch[0]);
                                    break;
                                }

                                // Match patterns like "May 13, 2025"
                                const americanDateMatch = text.match(
                                    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i
                                );
                                if (americanDateMatch) {
                                    date = cleanText(americanDateMatch[0]);
                                    break;
                                }
                            }
                        }

                        // Extract summary
                        let summary = ""; // Default to empty string

                        // Try elements with summary-like classes
                        const summaryElements = element.querySelectorAll(
                            "[class*=\"summary\"], [class*=\"excerpt\"], [class*=\"description\"], [class*=\"teaser\"], [class*=\"intro\"]"
                        );
                        if (summaryElements.length > 0) {
                            summary = cleanText(summaryElements[0].textContent);
                        }

                        // Try paragraphs
                        if (!summary) {
                            const paragraphs = element.querySelectorAll("p");
                            if (paragraphs.length > 0) {
                                // Skip paragraphs that contain the title
                                for (const p of paragraphs) {
                                    if (
                                        title &&
                                        p.textContent.includes(title)
                                    ) {
                                        continue;
                                    }
                                    if (p.textContent.trim().length > 20) {
                                        summary = cleanText(p.textContent);
                                        break;
                                    }
                                }
                            }
                        }

                        // Try spans (common in table-based layouts)
                        if (!summary) {
                            const spans = element.querySelectorAll("span");
                            // Skip the first span if it contains the date
                            for (let i = 0; i < spans.length; i++) {
                                const spanText = spans[i].textContent.trim();
                                // Skip if this span contains the date
                                if (date && spanText.includes(date)) {
                                    continue;
                                }
                                // Skip if this span contains the title
                                if (title && spanText.includes(title)) {
                                    continue;
                                }
                                // Use this span if it has substantial text
                                if (spanText.length > 30) {
                                    summary = cleanText(spanText);
                                    break;
                                }
                            }
                        }

                        // Try divs for summary
                        if (!summary) {
                            const divs = element.querySelectorAll("div");
                            for (const div of divs) {
                                const divText = div.textContent.trim();
                                // Skip if this div contains the date or title
                                if (
                                    (date && divText.includes(date)) ||
                                    (title && divText.includes(title))
                                ) {
                                    continue;
                                }
                                // Use this div if it has substantial text
                                if (
                                    divText.length > 40 &&
                                    divText.length < 500
                                ) {
                                    summary = cleanText(divText);
                                    break;
                                }
                            }
                        }

                        // Determine which method was used
                        let method = "direct";
                        if (
                            element.tagName === "TR" ||
                            element.closest("tr")
                        ) {
                            method = "table";
                        } else if (element.querySelector("h3 > a, h3 a")) {
                            method = "flat";
                        } else if (
                            element.classList &&
                            (element.classList.contains("card") ||
                                Array.from(element.classList).some((c) =>
                                    c.includes("card")
                                ) ||
                                Array.from(element.classList).some((c) =>
                                    c.includes("article")
                                ) ||
                                Array.from(element.classList).some((c) =>
                                    c.includes("post")
                                ) ||
                                Array.from(element.classList).some((c) =>
                                    c.includes("item")
                                ))
                        ) {
                            method = "card";
                        } else if (
                            element.hasAttribute("data-key") ||
                            element.hasAttribute("data-id")
                        ) {
                            method = "data-attribute";
                        } else if (
                            element.classList &&
                            (element.classList.contains("search-result") ||
                                Array.from(element.classList).some((c) =>
                                    c.includes("search")
                                ))
                        ) {
                            method = "search-result";
                        }

                        // Add to results if we have at least a title and link
                        if (title && link) {
                            // Calculate confidence scores with defensive checks
                            const titleConfidence = 0.9;
                            const linkConfidence = 0.9;
                            const dateConfidence = date ? 0.8 : 0;
                            const summaryConfidence = summary ? 0.8 : 0;

                            // Calculate overall confidence
                            const overallConfidence =
                                (titleConfidence +
                                    linkConfidence +
                                    dateConfidence * 0.5 +
                                    summaryConfidence * 0.5) /
                                3;

                            results.push({
                                title,
                                link,
                                date,
                                summary,
                                confidence: {
                                    title: titleConfidence,
                                    link: linkConfidence,
                                    date: dateConfidence,
                                    summary: summaryConfidence,
                                    overall: overallConfidence,
                                },
                                methods: {
                                    title: method,
                                    link: method,
                                    date: method,
                                    summary: method,
                                },
                            });
                        }
                    }

                    // Ensure results are unique by title
                    const uniqueResults = [];
                    const seenTitles = new Set();

                    for (const result of results) {
                        if (result.title && !seenTitles.has(result.title)) {
                            uniqueResults.push(result);
                            seenTitles.add(result.title);
                        }
                    }

                    // Filter out results with low confidence and non-article links
                    return uniqueResults
                        .filter((result) => result.title && result.link)
                        .filter((result) => {
                            // Skip cookie banners, privacy policies, etc.
                            const skipTitles = [
                                "cookie",
                                "privacy",
                                "terms",
                                "subscribe",
                                "newsletter",
                                "sign in",
                                "login",
                                "register",
                                "account",
                                "follow",
                            ];

                            for (const skip of skipTitles) {
                                if (
                                    result.title
                                        .toLowerCase()
                                        .includes(skip)
                                ) {
                                    return false;
                                }
                            }

                            // Make sure confidence is defined and above threshold
                            return (
                                result.confidence &&
                                result.confidence.overall > 0.5
                            );
                        })
                        .sort((a, b) => {
                            // Defensive sort that handles undefined confidence
                            const aConfidence =
                                a.confidence && a.confidence.overall
                                    ? a.confidence.overall
                                    : 0;
                            const bConfidence =
                                b.confidence && b.confidence.overall
                                    ? b.confidence.overall
                                    : 0;
                            return bConfidence - aConfidence;
                        });
                }, request.url);

                log.info(`Found ${articleElements.length} article elements`);

                // Process and store the extracted articles
                const filteredArticles = [];
                for (const article of articleElements) {
                    // Skip if we have reached the maximum number of items
                    if (maxItems > 0 && extractedCount >= maxItems) {
                        log.info(
                            `Reached maximum number of items (${maxItems}), stopping extraction`
                        );
                        break;
                    }

                    // POST-FILTERING: Apply strict filtering to ensure only true news articles are included
                    const isNewsArticle = isLikelyNewsArticle(article);
                    if (isNewsArticle) {
                        // Add extraction method to the set
                        methodsUsed.add(article.methods.title);

                        // Push the article to the dataset
                        await dataset.pushData(article);
                        filteredArticles.push(article);
                        extractedCount++;
                    }
                }

                log.info(
                    `Extracted ${filteredArticles.length} articles after filtering`
                );
            } catch (error) {
                log.error(`Error during article extraction: ${error.message}`);

                // If this is alarabiya.net, try the direct extraction method again
                if (request.url.includes("alarabiya.net")) {
                    try {
                        // Extract articles using a specialized method for alarabiya.net
                        const articles = await extractAlarabiyaArticlesDirectly(
                            page,
                            log
                        );

                        if (articles.length > 0) {
                            log.info(
                                `Extracted ${articles.length} articles from alarabiya.net after error recovery`
                            );

                            // Process and store the extracted articles
                            for (const article of articles) {
                                // Skip if we have reached the maximum number of items
                                if (maxItems > 0 && extractedCount >= maxItems) {
                                    log.info(
                                        `Reached maximum number of items (${maxItems}), stopping extraction`
                                    );
                                    break;
                                }

                                // Add extraction method to the set
                                methodsUsed.add("alarabiya-specialized");

                                // Push the article to the dataset
                                await dataset.pushData(article);
                                extractedCount++;
                            }

                            return;
                        }
                    } catch (directError) {
                        log.error(
                            `Error during alarabiya.net direct extraction: ${directError.message}`
                        );
                        throw error; // Re-throw the original error
                    }
                } else {
                    throw error; // Re-throw the error for non-alarabiya sites
                }
            }
        },
        // Handle errors
        failedRequestHandler({ request, error, log }) {
            log.error(
                `Request ${request.url} failed with error: ${error.message}`
            );
        },
        // Add retry configuration
        maxRequestRetries: 5,
    });

    // Specialized extraction function for alarabiya.net
    async function extractAlarabiyaArticlesDirectly(page, log) {
        log.info("Using specialized extraction method for alarabiya.net");

        // This function uses a completely different approach to extract articles from alarabiya.net
        // It is designed to be more robust against site changes and anti-bot measures

        try {
            // Get the HTML content of the page
            const html = await page.content();

            // Use JavaScript to parse the HTML directly
            const articles = await page.evaluate(() => {
                // Helper function to clean text
                const cleanText = (text) => {
                    if (!text) return "";
                    return text.replace(/\s+/g, " ").trim();
                };

                // Find all news items on the page
                const newsItems = [];

                // Look for all news cards on the page
                const newsCards = document.querySelectorAll(
                    ".card, article, .article, [class*=\"article-item\"], [class*=\"news-item\"]"
                );

                // Process each news card
                for (const card of newsCards) {
                    try {
                        // Skip if it is not a news item (e.g., navigation, ads)
                        if (
                            card.closest(
                                "nav, header, footer, [class*=\"menu\"], [class*=\"nav\"]"
                            )
                        ) {
                            continue;
                        }

                        // Skip if it is too small to be a news item
                        if (card.textContent.trim().length < 50) {
                            continue;
                        }

                        // Find the title
                        let title = "";
                        let link = "";

                        // Try to find the title in a heading
                        const heading = card.querySelector(
                            "h1, h2, h3, h4, h5, h6"
                        );
                        if (heading) {
                            title = cleanText(heading.textContent);

                            // Try to find the link in the heading
                            const headingLink = heading.querySelector("a");
                            if (headingLink) {
                                link = headingLink.href;
                            }
                        }

                        // If no heading, try to find a substantial link
                        if (!title || !link) {
                            const links = Array.from(
                                card.querySelectorAll("a")
                            ).filter((a) => a.textContent.trim().length > 20);

                            if (links.length > 0) {
                                title = title || cleanText(links[0].textContent);
                                link = link || links[0].href;
                            }
                        }

                        // Skip if we could not find a title or link
                        if (!title || !link) {
                            continue;
                        }

                        // Find the date
                        let date = "";

                        // Look for date elements
                        const dateElement = card.querySelector(
                            '[class*="date"], [class*="time"], time'
                        );
                        if (dateElement) {
                            date = cleanText(dateElement.textContent);
                        }

                        // If no date element, look for text that might be a date
                        if (!date) {
                            const spans = Array.from(
                                card.querySelectorAll("span, div")
                            );
                            for (const span of spans) {
                                const text = span.textContent.trim();
                                if (
                                    text.includes("ago") ||
                                    text.includes("day") ||
                                    text.includes("hour") ||
                                    text.includes("min") ||
                                    text.includes("May") ||
                                    text.includes("April") ||
                                    text.includes("March") ||
                                    /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(
                                        text
                                    )
                                ) {
                                    date = cleanText(text);
                                    break;
                                }
                            }
                        }

                        // Find the category/section
                        let category = "";

                        // Look for category elements
                        const categoryElement = card.querySelector(
                            '[class*="category"], [class*="section"]'
                        );
                        if (categoryElement) {
                            category = cleanText(categoryElement.textContent);
                        }

                        // If no category element, look for text that might be a category
                        if (!category) {
                            const spans = Array.from(
                                card.querySelectorAll("span, small, div")
                            );
                            const categoryNames = [
                                "News",
                                "Business",
                                "Sports",
                                "Entertainment",
                                "Politics",
                                "Technology",
                                "Science",
                                "Health",
                                "Opinion",
                                "World",
                                "Middle East",
                                "US News",
                                "Saudi Arabia",
                            ];

                            for (const span of spans) {
                                const text = span.textContent.trim();
                                if (
                                    categoryNames.some((cat) =>
                                        text.includes(cat)
                                    )
                                ) {
                                    category = cleanText(text);
                                    break;
                                }
                            }
                        }

                        // Add to results
                        newsItems.push({
                            title,
                            link,
                            date: date || "",
                            summary: category || "",
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: date ? 0.8 : 0,
                                summary: category ? 0.8 : 0,
                                overall: 0.9,
                            },
                            methods: {
                                title: "alarabiya-specialized",
                                link: "alarabiya-specialized",
                                date: "alarabiya-specialized",
                                summary: "alarabiya-specialized",
                            },
                        });
                    } catch (error) {
                        console.error("Error processing card:", error);
                        continue;
                    }
                }

                // If we did not find any news items with the above approach, try a more general approach
                if (newsItems.length === 0) {
                    // Look for all links that might be news items
                    const links = Array.from(document.querySelectorAll("a")).filter(
                        (a) => {
                            // Must have substantial text
                            const hasText = a.textContent.trim().length > 20;

                            // Must not be in navigation
                            const notInNav =
                                !a.closest(
                                    "nav, header, footer, [class*=\"menu\"], [class*=\"nav\"]"
                                );

                            // Must have a proper href
                            const hasHref = a.href && a.href.includes("/");

                            // Must not be a utility link
                            const notUtility =
                                !a.href.includes("/about") &&
                                !a.href.includes("/contact") &&
                                !a.href.includes("/privacy") &&
                                !a.href.includes("/terms");

                            return hasText && notInNav && hasHref && notUtility;
                        }
                    );

                    // Process each link
                    for (const link of links) {
                        try {
                            // Get the title from the link text
                            const title = cleanText(link.textContent);

                            // Get the parent container
                            let container = link.parentElement;
                            let depth = 0;

                            // Go up the DOM tree to find a container with more content
                            while (
                                depth < 3 &&
                                container &&
                                container.parentElement
                            ) {
                                if (
                                    container.textContent.trim().length > 100 ||
                                    container.querySelectorAll("span, div")
                                        .length > 2
                                ) {
                                    break;
                                }
                                container = container.parentElement;
                                depth++;
                            }

                            // Find the date
                            let date = "";

                            // Look for date elements
                            const dateElement = container.querySelector(
                                '[class*="date"], [class*="time"], time'
                            );
                            if (dateElement) {
                                date = cleanText(dateElement.textContent);
                            }

                            // If no date element, look for text that might be a date
                            if (!date) {
                                const spans = Array.from(
                                    container.querySelectorAll("span, div")
                                );
                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (
                                        text.includes("ago") ||
                                        text.includes("day") ||
                                        text.includes("hour") ||
                                        text.includes("min") ||
                                        text.includes("May") ||
                                        text.includes("April") ||
                                        text.includes("March") ||
                                        /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(
                                            text
                                        )
                                    ) {
                                        date = cleanText(text);
                                        break;
                                    }
                                }
                            }

                            // Find the category/section
                            let category = "";

                            // Look for category elements
                            const categoryElement = container.querySelector(
                                '[class*="category"], [class*="section"]'
                            );
                            if (categoryElement) {
                                category = cleanText(
                                    categoryElement.textContent
                                );
                            }

                            // If no category element, look for text that might be a category
                            if (!category) {
                                const spans = Array.from(
                                    container.querySelectorAll(
                                        "span, small, div"
                                    )
                                );
                                const categoryNames = [
                                    "News",
                                    "Business",
                                    "Sports",
                                    "Entertainment",
                                    "Politics",
                                    "Technology",
                                    "Science",
                                    "Health",
                                    "Opinion",
                                    "World",
                                    "Middle East",
                                    "US News",
                                    "Saudi Arabia",
                                ];

                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (
                                        categoryNames.some((cat) =>
                                            text.includes(cat)
                                        )
                                    ) {
                                        category = cleanText(text);
                                        break;
                                    }
                                }
                            }

                            // Add to results
                            newsItems.push({
                                title,
                                link: link.href,
                                date: date || "",
                                summary: category || "",
                                confidence: {
                                    title: 0.9,
                                    link: 0.9,
                                    date: date ? 0.8 : 0,
                                    summary: category ? 0.8 : 0,
                                    overall: 0.9,
                                },
                                methods: {
                                    title: "alarabiya-specialized",
                                    link: "alarabiya-specialized",
                                    date: "alarabiya-specialized",
                                    summary: "alarabiya-specialized",
                                },
                            });
                        } catch (error) {
                            console.error("Error processing link:", error);
                            continue;
                        }
                    }
                }

                // SPECIAL CASE: If we are on the search results page, look for the search results directly
                if (
                    window.location.href.includes("/search") ||
                    window.location.href.includes("?q=") ||
                    window.location.href.includes("?query=")
                ) {
                    // Try to find all search result items
                    const searchResults = document.querySelectorAll(
                        ".search-result, [class*=\"search-result\"], [class*=\"search_result\"], [class*=\"result-item\"], [class*=\"search-item\"]"
                    );

                    if (searchResults.length > 0) {
                        for (const result of searchResults) {
                            try {
                                // Find the title and link
                                let title = "";
                                let link = "";

                                // Try to find the title in a heading
                                const heading = result.querySelector(
                                    "h1, h2, h3, h4, h5, h6"
                                );
                                if (heading) {
                                    title = cleanText(heading.textContent);

                                    // Try to find the link in the heading
                                    const headingLink =
                                        heading.querySelector("a");
                                    if (headingLink) {
                                        link = headingLink.href;
                                    }
                                }

                                // If no heading, try to find a substantial link
                                if (!title || !link) {
                                    const links = Array.from(
                                        result.querySelectorAll("a")
                                    ).filter(
                                        (a) =>
                                            a.textContent.trim().length > 20
                                    );

                                    if (links.length > 0) {
                                        title =
                                            title ||
                                            cleanText(links[0].textContent);
                                        link = link || links[0].href;
                                    }
                                }

                                // Skip if we could not find a title or link
                                if (!title || !link) {
                                    continue;
                                }

                                // Find the date
                                let date = "";

                                // Look for date elements
                                const dateElement = result.querySelector(
                                    '[class*="date"], [class*="time"], time'
                                );
                                if (dateElement) {
                                    date = cleanText(dateElement.textContent);
                                }

                                // If no date element, look for text that might be a date
                                if (!date) {
                                    const spans = Array.from(
                                        result.querySelectorAll("span, div")
                                    );
                                    for (const span of spans) {
                                        const text = span.textContent.trim();
                                        if (
                                            text.includes("ago") ||
                                            text.includes("day") ||
                                            text.includes("hour") ||
                                            text.includes("min") ||
                                            text.includes("May") ||
                                            text.includes("April") ||
                                            text.includes("March") ||
                                            /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(
                                                text
                                            )
                                        ) {
                                            date = cleanText(text);
                                            break;
                                        }
                                    }
                                }

                                // Find the category/section
                                let category = "";

                                // Look for category elements
                                const categoryElement = result.querySelector(
                                    '[class*="category"], [class*="section"]'
                                );
                                if (categoryElement) {
                                    category = cleanText(
                                        categoryElement.textContent
                                    );
                                }

                                // If no category element, look for text that might be a category
                                if (!category) {
                                    const spans = Array.from(
                                        result.querySelectorAll(
                                            "span, small, div"
                                        )
                                    );
                                    const categoryNames = [
                                        "News",
                                        "Business",
                                        "Sports",
                                        "Entertainment",
                                        "Politics",
                                        "Technology",
                                        "Science",
                                        "Health",
                                        "Opinion",
                                        "World",
                                        "Middle East",
                                        "US News",
                                        "Saudi Arabia",
                                    ];

                                    for (const span of spans) {
                                        const text = span.textContent.trim();
                                        if (
                                            categoryNames.some((cat) =>
                                                text.includes(cat)
                                            )
                                        ) {
                                            category = cleanText(text);
                                            break;
                                        }
                                    }
                                }

                                // Add to results
                                newsItems.push({
                                    title,
                                    link,
                                    date: date || "",
                                    summary: category || "",
                                    confidence: {
                                        title: 0.9,
                                        link: 0.9,
                                        date: date ? 0.8 : 0,
                                        summary: category ? 0.8 : 0,
                                        overall: 0.9,
                                    },
                                    methods: {
                                        title: "alarabiya-specialized",
                                        link: "alarabiya-specialized",
                                        date: "alarabiya-specialized",
                                        summary: "alarabiya-specialized",
                                    },
                                });
                            } catch (error) {
                                console.error(
                                    "Error processing search result:",
                                    error
                                );
                                continue;
                            }
                        }
                    }
                }

                // SPECIAL CASE: Look for news items in the main content area
                const mainContent = document.querySelector(
                    "main, [role=\"main\"], #content, .content, [class*=\"main-content\"]"
                );
                if (mainContent) {
                    // Look for all links in the main content area
                    const links = Array.from(
                        mainContent.querySelectorAll("a")
                    ).filter((a) => {
                        // Must have substantial text
                        const hasText = a.textContent.trim().length > 20;

                        // Must have a proper href
                        const hasHref = a.href && a.href.includes("/");

                        // Must not be a utility link
                        const notUtility =
                            !a.href.includes("/about") &&
                            !a.href.includes("/contact") &&
                            !a.href.includes("/privacy") &&
                            !a.href.includes("/terms");

                        return hasText && hasHref && notUtility;
                    });

                    // Process each link
                    for (const link of links) {
                        try {
                            // Skip if this link is already in the results
                            if (newsItems.some((item) => item.link === link.href)) {
                                continue;
                            }

                            // Get the title from the link text
                            const title = cleanText(link.textContent);

                            // Get the parent container
                            let container = link.parentElement;
                            let depth = 0;

                            // Go up the DOM tree to find a container with more content
                            while (
                                depth < 3 &&
                                container &&
                                container.parentElement
                            ) {
                                if (
                                    container.textContent.trim().length > 100 ||
                                    container.querySelectorAll("span, div")
                                        .length > 2
                                ) {
                                    break;
                                }
                                container = container.parentElement;
                                depth++;
                            }

                            // Find the date
                            let date = "";

                            // Look for date elements
                            const dateElement = container.querySelector(
                                '[class*="date"], [class*="time"], time'
                            );
                            if (dateElement) {
                                date = cleanText(dateElement.textContent);
                            }

                            // If no date element, look for text that might be a date
                            if (!date) {
                                const spans = Array.from(
                                    container.querySelectorAll("span, div")
                                );
                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (
                                        text.includes("ago") ||
                                        text.includes("day") ||
                                        text.includes("hour") ||
                                        text.includes("min") ||
                                        text.includes("May") ||
                                        text.includes("April") ||
                                        text.includes("March") ||
                                        /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(
                                            text
                                        )
                                    ) {
                                        date = cleanText(text);
                                        break;
                                    }
                                }
                            }

                            // Find the category/section
                            let category = "";

                            // Look for category elements
                            const categoryElement = container.querySelector(
                                '[class*="category"], [class*="section"]'
                            );
                            if (categoryElement) {
                                category = cleanText(
                                    categoryElement.textContent
                                );
                            }

                            // If no category element, look for text that might be a category
                            if (!category) {
                                const spans = Array.from(
                                    container.querySelectorAll(
                                        "span, small, div"
                                    )
                                );
                                const categoryNames = [
                                    "News",
                                    "Business",
                                    "Sports",
                                    "Entertainment",
                                    "Politics",
                                    "Technology",
                                    "Science",
                                    "Health",
                                    "Opinion",
                                    "World",
                                    "Middle East",
                                    "US News",
                                    "Saudi Arabia",
                                ];

                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (
                                        categoryNames.some((cat) =>
                                            text.includes(cat)
                                        )
                                    ) {
                                        category = cleanText(text);
                                        break;
                                    }
                                }
                            }

                            // Add to results
                            newsItems.push({
                                title,
                                link: link.href,
                                date: date || "",
                                summary: category || "",
                                confidence: {
                                    title: 0.9,
                                    link: 0.9,
                                    date: date ? 0.8 : 0,
                                    summary: category ? 0.8 : 0,
                                    overall: 0.9,
                                },
                                methods: {
                                    title: "alarabiya-specialized",
                                    link: "alarabiya-specialized",
                                    date: "alarabiya-specialized",
                                    summary: "alarabiya-specialized",
                                },
                            });
                        } catch (error) {
                            console.error("Error processing link:", error);
                            continue;
                        }
                    }
                }

                // SPECIAL CASE: Look for news items in a list
                const lists = document.querySelectorAll("ul, ol");
                for (const list of lists) {
                    // Skip if it is a navigation list
                    if (
                        list.closest(
                            "nav, header, footer, [class*=\"menu\"], [class*=\"nav\"]"
                        )
                    ) {
                        continue;
                    }

                    // Skip if it is a small list
                    if (list.children.length < 3) {
                        continue;
                    }

                    // Process each list item
                    const listItems = list.querySelectorAll("li");
                    for (const item of listItems) {
                        try {
                            // Skip if it is too small to be a news item
                            if (item.textContent.trim().length < 50) {
                                continue;
                            }

                            // Find the title and link
                            let title = "";
                            let link = "";

                            // Try to find the title in a heading
                            const heading = item.querySelector(
                                "h1, h2, h3, h4, h5, h6"
                            );
                            if (heading) {
                                title = cleanText(heading.textContent);

                                // Try to find the link in the heading
                                const headingLink =
                                    heading.querySelector("a");
                                if (headingLink) {
                                    link = headingLink.href;
                                }
                            }

                            // If no heading, try to find a substantial link
                            if (!title || !link) {
                                const links = Array.from(
                                    item.querySelectorAll("a")
                                ).filter(
                                    (a) => a.textContent.trim().length > 20
                                );

                                if (links.length > 0) {
                                    title =
                                        title ||
                                        cleanText(links[0].textContent);
                                    link = link || links[0].href;
                                }
                            }

                            // Skip if we could not find a title or link
                            if (!title || !link) {
                                continue;
                            }

                            // Skip if this link is already in the results
                            if (newsItems.some((item) => item.link === link)) {
                                continue;
                            }

                            // Find the date
                            let date = "";

                            // Look for date elements
                            const dateElement = item.querySelector(
                                '[class*="date"], [class*="time"], time'
                            );
                            if (dateElement) {
                                date = cleanText(dateElement.textContent);
                            }

                            // If no date element, look for text that might be a date
                            if (!date) {
                                const spans = Array.from(
                                    item.querySelectorAll("span, div")
                                );
                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (
                                        text.includes("ago") ||
                                        text.includes("day") ||
                                        text.includes("hour") ||
                                        text.includes("min") ||
                                        text.includes("May") ||
                                        text.includes("April") ||
                                        text.includes("March") ||
                                        /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(
                                            text
                                        )
                                    ) {
                                        date = cleanText(text);
                                        break;
                                    }
                                }
                            }

                            // Find the category/section
                            let category = "";

                            // Look for category elements
                            const categoryElement = item.querySelector(
                                '[class*="category"], [class*="section"]'
                            );
                            if (categoryElement) {
                                category = cleanText(
                                    categoryElement.textContent
                                );
                            }

                            // If no category element, look for text that might be a category
                            if (!category) {
                                const spans = Array.from(
                                    item.querySelectorAll("span, small, div")
                                );
                                const categoryNames = [
                                    "News",
                                    "Business",
                                    "Sports",
                                    "Entertainment",
                                    "Politics",
                                    "Technology",
                                    "Science",
                                    "Health",
                                    "Opinion",
                                    "World",
                                    "Middle East",
                                    "US News",
                                    "Saudi Arabia",
                                ];

                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (
                                        categoryNames.some((cat) =>
                                            text.includes(cat)
                                        )
                                    ) {
                                        category = cleanText(text);
                                        break;
                                    }
                                }
                            }

                            // Add to results
                            newsItems.push({
                                title,
                                link,
                                date: date || "",
                                summary: category || "",
                                confidence: {
                                    title: 0.9,
                                    link: 0.9,
                                    date: date ? 0.8 : 0,
                                    summary: category ? 0.8 : 0,
                                    overall: 0.9,
                                },
                                methods: {
                                    title: "alarabiya-specialized",
                                    link: "alarabiya-specialized",
                                    date: "alarabiya-specialized",
                                    summary: "alarabiya-specialized",
                                },
                            });
                        } catch (error) {
                            console.error("Error processing list item:", error);
                            continue;
                        }
                    }
                }

                // Filter out duplicates
                const uniqueItems = [];
                const seenLinks = new Set();

                for (const item of newsItems) {
                    if (!seenLinks.has(item.link)) {
                        uniqueItems.push(item);
                        seenLinks.add(item.link);
                    }
                }

                // Filter out non-news items
                return uniqueItems.filter((item) => {
                    // Must have a title and link
                    if (!item.title || !item.link) {
                        return false;
                    }

                    // Skip very short titles
                    if (item.title.length < 20) {
                        return false;
                    }

                    // Skip titles that are just single words or very short phrases
                    if (item.title.split(" ").length < 3) {
                        return false;
                    }

                    // Skip navigation links
                    if (
                        item.link.includes("/about") ||
                        item.link.includes("/contact") ||
                        item.link.includes("/privacy") ||
                        item.link.includes("/terms") ||
                        item.link.includes("/login") ||
                        item.link.includes("/register") ||
                        item.link.includes("/subscribe") ||
                        item.link.includes("/newsletter")
                    ) {
                        return false;
                    }

                    // Skip cookie banners, privacy policies, etc.
                    const skipTitles = [
                        "cookie",
                        "privacy",
                        "terms",
                        "subscribe",
                        "newsletter",
                        "sign in",
                        "login",
                        "register",
                        "account",
                        "follow",
                    ];

                    for (const skip of skipTitles) {
                        if (item.title.toLowerCase().includes(skip)) {
                            return false;
                        }
                    }

                    // Keep items with news sections in the URL
                    if (
                        item.link.includes("/News/") ||
                        item.link.includes("/Views/") ||
                        item.link.includes("/Business/") ||
                        item.link.includes("/sports/") ||
                        item.link.includes("/lifestyle/")
                    ) {
                        return true;
                    }

                    // Keep items with dates
                    if (item.date) {
                        return true;
                    }

                    // Keep items with categories
                    if (item.summary) {
                        return true;
                    }

                    // Default to true for anything that made it this far
                    return true;
                });
            });

            return articles;
        } catch (error) {
            log.error(
                `Error in specialized extraction for alarabiya.net: ${error.message}`
            );
            return [];
        }
    }

    // Specialized extraction function for aps.dz
    async function extractApsDzArticlesDirectly(page, log) {
        log.info("Using specialized extraction method for aps.dz");

        try {
            // Use JavaScript to parse the HTML directly
            const articles = await page.evaluate(() => {
                // Helper function to clean text
                const cleanText = (text) => {
                    if (!text) return "";
                    return text.replace(/\s+/g, " ").trim();
                };

                // Find all news items on the page
                const newsItems = [];

                // Target the main search results container
                const searchResultsContainer = document.querySelector(
                    ".search-results, #search-results, [class*=\"search-results\"]"
                );

                if (!searchResultsContainer) {
                    console.log("Could not find search results container for aps.dz");
                    return [];
                }

                // Find all result items within the container
                const resultItems = searchResultsContainer.querySelectorAll(
                    "dl.search-results > dt, .result-item, [class*=\"result-item\"]"
                );

                // Process each result item
                for (const item of resultItems) {
                    try {
                        // Find the title and link
                        let title = "";
                        let link = "";

                        // The title is in the dt > a element
                        const titleLink = item.querySelector("a");
                        if (titleLink) {
                            title = cleanText(titleLink.textContent);
                            link = titleLink.href;
                        }

                        // Skip if we could not find a title or link
                        if (!title || !link) {
                            continue;
                        }

                        // Find the summary (in the following dd element)
                        let summary = "";
                        const summaryElement = item.nextElementSibling;
                        if (
                            summaryElement &&
                            summaryElement.tagName === "DD"
                        ) {
                            summary = cleanText(summaryElement.textContent);
                        }

                        // Find the date (also in the following dd element)
                        let date = "";
                        if (summaryElement) {
                            const dateElement = summaryElement.querySelector(
                                ".small, .created, [class*=\"date\"]"
                            );
                            if (dateElement) {
                                date = cleanText(dateElement.textContent);
                                // Remove the date from the summary if it is there
                                summary = summary.replace(date, "").trim();
                            }
                        }

                        // Add to results
                        newsItems.push({
                            title,
                            link,
                            date: date || "",
                            summary: summary || "",
                            confidence: {
                                title: 0.95,
                                link: 0.95,
                                date: date ? 0.9 : 0,
                                summary: summary ? 0.9 : 0,
                                overall: 0.95,
                            },
                            methods: {
                                title: "apsdz-specialized",
                                link: "apsdz-specialized",
                                date: "apsdz-specialized",
                                summary: "apsdz-specialized",
                            },
                        });
                    } catch (error) {
                        console.error("Error processing aps.dz item:", error);
                        continue;
                    }
                }

                // Filter out duplicates
                const uniqueItems = [];
                const seenLinks = new Set();

                for (const item of newsItems) {
                    if (!seenLinks.has(item.link)) {
                        uniqueItems.push(item);
                        seenLinks.add(item.link);
                    }
                }

                return uniqueItems;
            });

            return articles;
        } catch (error) {
            log.error(
                `Error in specialized extraction for aps.dz: ${error.message}`
            );
            return [];
        }
    }

    // Helper function to determine if an article is likely a true news article
    function isLikelyNewsArticle(article) {
        // Skip navigation links, section pages, and utility pages
        const navigationPatterns = [
            "/about",
            "/contact",
            "/privacy",
            "/terms",
            "/subscribe",
            "/newsletter",
            "/rss",
            "/feed",
            "/login",
            "/register",
            "/account",
            "/profile",
            "/settings",
        ];

        // Check if the link matches any navigation pattern
        for (const pattern of navigationPatterns) {
            if (article.link.includes(pattern)) {
                // Special case: If the link includes both a navigation pattern AND a date pattern, it might still be an article
                const hasDatePattern =
                    /\/20\d{2}\/\d{2}\/\d{2}\//.test(article.link) ||
                    /\/20\d{2}-\d{2}-\d{2}\//.test(article.link);

                if (!hasDatePattern) {
                    return false;
                }
            }
        }

        // Skip very short titles (likely navigation or utility links)
        if (article.title.length < 20) {
            return false;
        }

        // Skip titles that are just single words or very short phrases
        if (article.title.split(" ").length < 3) {
            return false;
        }

        // Skip titles that are just category names
        const categoryNames = [
            "News",
            "Business",
            "Sports",
            "Entertainment",
            "Politics",
            "Technology",
            "Science",
            "Health",
            "Opinion",
            "World",
            "Local",
            "National",
            "International",
            "Economy",
            "Finance",
            "Markets",
            "Money",
            "Investing",
            "Stocks",
            "Bonds",
            "Commodities",
            "Currencies",
            "Crypto",
            "Real Estate",
            "Energy",
            "Oil",
            "Gas",
            "Aviation",
            "Transport",
        ];

        // Special case for alarabiya.net
        if (article.link.includes("alarabiya.net")) {
            // For alarabiya.net, we want to keep all articles that have a proper link structure
            // These typically include a section name followed by a specific article path

            // Check if the link contains a news section pattern
            const hasNewsSection =
                article.link.includes("/News/") ||
                article.link.includes("/Views/") ||
                article.link.includes("/Business/") ||
                article.link.includes("/sports/") ||
                article.link.includes("/lifestyle/");

            if (hasNewsSection) {
                return true;
            }

            // Check if the title looks like a news headline
            if (article.title.length > 30 && article.title.split(" ").length > 5) {
                return true;
            }

            // Check if it has a date
            if (
                article.date &&
                (article.date.includes("days ago") ||
                    article.date.includes("May") ||
                    article.date.includes("April") ||
                    article.date.includes("March"))
            ) {
                return true;
            }
        }

        // For other sites, apply standard checks
        for (const category of categoryNames) {
            if (article.title === category) {
                return false;
            }
        }

        // Check if the title contains keywords that suggest it is a news article
        const newsKeywords = [
            "says",
            "report",
            "announce",
            "launch",
            "reveal",
            "discover",
            "study",
            "research",
            "find",
            "show",
            "prove",
            "confirm",
            "claim",
            "allege",
            "accuse",
            "deny",
            "refute",
            "reject",
            "approve",
            "endorse",
            "support",
            "oppose",
            "criticize",
            "attack",
            "defend",
            "protest",
            "demonstrate",
            "rally",
            "vote",
            "elect",
            "appoint",
            "nominate",
            "resign",
            "fire",
            "hire",
            "promote",
            "demote",
            "award",
            "honor",
            "recognize",
            "win",
            "lose",
            "defeat",
            "beat",
            "tie",
            "draw",
            "match",
            "increase",
            "decrease",
            "rise",
            "fall",
            "grow",
            "shrink",
            "expand",
            "contract",
            "improve",
            "worsen",
            "strengthen",
            "weaken",
            "boost",
            "reduce",
            "cut",
            "raise",
            "lower",
        ];

        let containsNewsKeyword = false;
        for (const keyword of newsKeywords) {
            if (article.title.toLowerCase().includes(keyword)) {
                containsNewsKeyword = true;
                break;
            }
        }

        // If the title is long enough and contains a news keyword, it is likely a news article
        if (article.title.length > 40 && containsNewsKeyword) {
            return true;
        }

        // If the title mentions a specific date or time period, it is likely a news article
        if (
            article.title.match(/\b\d{4}\b/) ||
            article.title.includes("yesterday") ||
            article.title.includes("today") ||
            article.title.includes("tomorrow") ||
            article.title.includes("last week") ||
            article.title.includes("next month")
        ) {
            return true;
        }

        // If the article has a date and the title is substantial, it is likely a news article
        if (article.date && article.title.length > 30) {
            return true;
        }

        // If the article has both a date and a summary, it is very likely a news article
        if (article.date && article.summary && article.summary.length > 20) {
            return true;
        }

        // If the title contains quotes, it is likely a news article
        if (
            article.title.includes("\"") ||
            article.title.includes("'") ||
            article.title.includes("\"") ||
            article.title.includes("'")
        ) {
            return true;
        }

        // Default to false for anything that does not match the above criteria
        return false;
    }

    // Add the URL to the queue
    await crawler.run([url]);

    // Get all the data from the dataset
    const results = await dataset.getData();

    // Calculate success metrics
    const totalItems = results.items.flatMap((item) => item).length;
    const itemsWithAllFields = results.items
        .flatMap((item) => item)
        .filter((item) => item.title && item.link && item.date && item.summary)
        .length;

    const successRate = totalItems > 0 ? itemsWithAllFields / totalItems : 0;

    // Prepare the output
    const output = {
        newsItems: results.items.flatMap((item) => item),
        totalCount: totalItems,
        url: url,
        extractionStats: {
            methodsUsed: Array.from(methodsUsed),
            successRate: successRate,
            completeItems: itemsWithAllFields,
            partialItems: totalItems - itemsWithAllFields,
        },
    };

    // Store the output
    await Actor.pushData(output);
    console.log("Scraping finished successfully!");
});
