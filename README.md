# Adaptive News Scraper Actor - README

## Overview
This is an adaptive Apify actor that scrapes news items from various dynamic news sites without requiring manual configuration for each site. It automatically detects and extracts the following information for each news item:
- Title
- Link
- Date
- Summary

## Key Features

- **Adaptive Detection**: Automatically identifies news articles across different site layouts
- **Multiple Extraction Methods**: Uses various strategies with fallbacks to extract content
- **Confidence Scoring**: Prioritizes the most reliable extraction methods
- **Fallback Mechanisms**: Gracefully handles different site structures
- **No Manual Configuration**: Works across multiple news sites without site-specific selectors

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/adaptive-news-scraper.git

# Navigate to the project directory
cd adaptive-news-scraper

# Install dependencies
npm install
```

## Usage

### Local Development
To run the actor locally:

```bash
# Run with default input
npm start

# Run with custom input
APIFY_INPUT_JSON='{"url": "https://www.aljazeera.com/search/iraq%20oil?sort=date", "maxItems": 10, "waitTime": 15}' npm start

# Run the test script (tests with sample URLs)
node test.js
```

### Apify Platform
1. Create a new actor on the Apify platform
2. Upload the code or link your GitHub repository
3. Set the input parameters:
   - `url`: URL of the news site to scrape
   - `maxItems`: Maximum number of news items to extract (0 for unlimited)
   - `waitTime`: Time to wait for dynamic content to load (in seconds)
4. Run the actor

## Input Parameters

- **url** (required): The URL of the news site to scrape
- **maxItems** (optional): Maximum number of news items to extract (0 for unlimited, default: 0)
- **waitTime** (optional): Time to wait for dynamic content to load in seconds (default: 10)

## How It Works

The actor uses a multi-layered approach to detect and extract news content:

### 1. Article Detection Methods
- **Semantic HTML Analysis**: Looks for semantic elements like `<article>`, `<section>`, `<main>`
- **Class/ID Pattern Matching**: Searches for common news-related class/ID patterns
- **DOM Structure Analysis**: Identifies repeated patterns that likely represent articles
- **Content-Based Heuristics**: Uses content characteristics to identify news items
- **Readability Integration**: Falls back to Mozilla's Readability for single-article pages

### 2. Content Extraction Methods
For each detected article, the actor extracts content using multiple strategies:

- **Title Extraction**: Heading elements, class patterns, anchor text, metadata
- **Link Extraction**: Anchor tags, canonical links, metadata
- **Date Extraction**: Time elements, datetime attributes, class patterns, regex patterns
- **Summary Extraction**: Class patterns, meta descriptions, first paragraphs

### 3. Confidence Scoring
Each extraction method is assigned a confidence score, and the actor prioritizes results with higher confidence.

## Output Format

The actor outputs data in JSON format:

```json
{
  "newsItems": [
    {
      "title": "Example News Title",
      "link": "https://example.com/news/article",
      "date": "2025-06-01",
      "summary": "This is an example summary of the news article..."
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

## Supported News Sites

The actor is designed to work with a wide variety of news sites without manual configuration. It has been tested with:

- Al Jazeera
- BBC News
- CNN
- Reuters
- The Guardian
- The New York Times
- And many more...

## Limitations

- The actor does not handle pagination by default
- No authentication support
- Date formats may vary depending on the source site
- Extraction quality may vary across different site layouts

## Customization

While the actor is designed to work without manual configuration, you can enhance its performance for specific sites by modifying the detection and extraction patterns in:

- `lib/article-detector.js`: Article detection algorithms
- `lib/content-extractor.js`: Content extraction methods
- `lib/utils.js`: Utility functions and patterns
