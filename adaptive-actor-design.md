# Adaptive News Scraper Actor Design

## Project Structure
```
apify-news-scraper/
├── main.js             # Main entry point for the actor
├── package.json        # Project dependencies and metadata
├── INPUT_SCHEMA.json   # Schema for actor input
├── README.md           # Documentation for the actor
└── lib/                # Library of helper functions
    ├── article-detector.js    # Algorithms for detecting article elements
    ├── content-extractor.js   # Extraction logic for article content
    └── utils.js               # Utility functions
```

## Dependencies
- `apify`: Core SDK for creating Apify actors
- `playwright`: For browser automation and handling dynamic content
- `crawlee`: For web scraping utilities
- `cheerio`: For HTML parsing and manipulation
- `readability`: Mozilla's Readability library for content extraction

## Actor Input Schema
```json
{
  "title": "Adaptive News Scraper Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "url": {
      "title": "URL",
      "type": "string",
      "description": "URL of the news site to scrape",
      "editor": "textfield"
    },
    "maxItems": {
      "title": "Maximum Items",
      "type": "integer",
      "description": "Maximum number of news items to extract (0 for unlimited)",
      "default": 0,
      "minimum": 0,
      "editor": "number"
    },
    "waitTime": {
      "title": "Wait Time",
      "type": "integer",
      "description": "Time to wait for dynamic content to load (in seconds)",
      "default": 10,
      "minimum": 1,
      "maximum": 60,
      "editor": "number"
    }
  },
  "required": ["url"]
}
```

## Adaptive Scraping Strategy

### 1. Article Detection Methods
The actor will use multiple methods to detect news articles:

1. **Semantic HTML Analysis**:
   - Look for semantic elements like `<article>`, `<section>`, `<main>`
   - Identify content within these elements that matches news article patterns

2. **Common Class/ID Pattern Matching**:
   - Search for common class/ID patterns used by news sites:
     - Classes/IDs containing: article, news, story, post, entry, etc.
   - Use regular expressions to match these patterns

3. **DOM Structure Analysis**:
   - Analyze DOM structure to identify repeated patterns that likely represent articles
   - Look for parent elements with multiple similar child structures

4. **Content-Based Heuristics**:
   - Identify elements with substantial text content
   - Look for elements with both text and images
   - Detect headline-like text (larger font, prominent position)

5. **Readability Integration**:
   - Use Mozilla's Readability algorithm as a fallback for single-article pages

### 2. Content Extraction Methods

For each detected article, extract content using these methods (with fallbacks):

1. **Title Extraction**:
   - Look for heading elements (`<h1>`, `<h2>`, etc.) within the article
   - Check for elements with classes/IDs containing: title, headline, heading
   - Fall back to the first prominent text in the article
   - Use metadata (Open Graph, Twitter cards) as additional sources

2. **Link Extraction**:
   - Find anchor tags (`<a>`) that wrap or are near the title
   - Check for canonical links in article metadata
   - Fall back to the current page URL for single-article pages

3. **Date Extraction**:
   - Look for `<time>` elements or elements with datetime attributes
   - Search for elements with classes/IDs containing: date, time, published, posted
   - Use regular expressions to identify date patterns in text
   - Extract from metadata (Open Graph, schema.org)
   - Use NLP-based date recognition as a last resort

4. **Summary Extraction**:
   - Look for elements with classes/IDs containing: summary, excerpt, description, teaser
   - Check for meta description tags
   - Fall back to the first paragraph or sentences of the article content
   - Use Open Graph description as an alternative source

### 3. Prioritization and Confidence Scoring

- Implement a confidence scoring system for each extraction method
- Combine results from multiple methods, prioritizing those with higher confidence
- Return the highest confidence result for each field

### 4. Error Handling and Fallbacks

- Implement graceful degradation when certain fields cannot be extracted
- Provide partial results rather than failing completely
- Log detailed information about which methods succeeded/failed

## Output Format
```json
{
  "newsItems": [
    {
      "title": "Example News Title",
      "link": "https://example.com/news/article",
      "date": "2025-06-01",
      "summary": "This is an example summary of the news article...",
      "confidence": {
        "title": 0.95,
        "link": 1.0,
        "date": 0.8,
        "summary": 0.7
      }
    },
    ...
  ],
  "totalCount": 10,
  "url": "https://example.com/news",
  "extractionStats": {
    "methodsUsed": ["semanticHTML", "classPatterns", "domStructure"],
    "successRate": 0.85
  }
}
```
