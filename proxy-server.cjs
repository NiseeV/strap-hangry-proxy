const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

// ===== CONFIG =====
const cache = {}; // Simple in-memory cache (resets when server restarts)
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const HARD_RESULT_CAP = 40; // Max restaurants per query
let monthlyApiCount = 0; // Track API usage

app.use(cors());

// ===== ROOT ROUTE =====
app.get('/', (req, res) => {
  res.send('🚀 StrapHangry Proxy is running! Use /places?query=YOUR_QUERY or /places?pagetoken=YOUR_TOKEN to fetch data.');
});

// ===== PLACES ROUTE =====
app.get('/places', async (req, res) => {
  const API_KEY = 'AIzaSyBpkLb6gpiyQhtCsWJfDzXPT_fiewCmPcE';
  const { query, limit, min_rating, open_now, keyword } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const resultLimit = limit ? Math.min(parseInt(limit), HARD_RESULT_CAP) : HARD_RESULT_CAP;
  const cacheKey = `${query}-${limit || ''}-${min_rating || ''}-${open_now || ''}-${keyword || ''}`;
  const now = Date.now();

  // Serve from cache if available
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_DURATION) {
    console.log(`✅ Serving from cache: ${cacheKey}`);
    return res.json(cache[cacheKey].data);
  }

  let results = [];
  let nextPageToken = null;
  let pageCount = 0;

  try {
    do {
      // Build request URL
      let targetUrl;
      if (nextPageToken) {
        targetUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${API_KEY}`;
      } else {
        targetUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
      }

      // API call
      const response = await fetch(targetUrl);
      monthlyApiCount++;
      const data = await response.json();

      if (data.results) {
        results = results.concat(data.results);
      }

      nextPageToken = data.next_page_token || null;
      pageCount++;

      // Apply early filters
      let filteredResults = results;
      if (min_rating) {
        filteredResults = filteredResults.filter(r => r.rating && r.rating >= parseFloat(min_rating));
      }
      if (open_now && open_now.toLowerCase() === 'true') {
        filteredResults = filteredResults.filter(r => r.opening_hours && r.opening_hours.open_now);
      }
      if (keyword) {
        const keywordLower = keyword.toLowerCase();
        filteredResults = filteredResults.filter(r => r.name.toLowerCase().includes(keywordLower));
      }

      // Stop early if enough filtered results
      if (filteredResults.length >= resultLimit) {
        results = filteredResults.slice(0, resultLimit);
        nextPageToken = null;
        break;
      }

      // Google requires a delay before using next_page_token
      if (nextPageToken) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } while (nextPageToken && pageCount < 3 && results.length < resultLimit);

    // Final filter + limit
    if (min_rating) {
      results = results.filter(r => r.rating && r.rating >= parseFloat(min_rating));
    }
    if (open_now && open_now.toLowerCase() === 'true') {
      results = results.filter(r => r.opening_hours && r.opening_hours.open_now);
    }
    if (keyword) {
      const keywordLower = keyword.toLowerCase();
      results = results.filter(r => r.name.toLowerCase().includes(keywordLower));
    }
    results = results.slice(0, resultLimit);

    // Cache results
    cache[cacheKey] = {
      timestamp: now,
      data: {
        results,
        total_results: results.length,
        api_requests_used_this_month: monthlyApiCount,
        next_free_reset: '1st of next month'
      }
    };

    res.json(cache[cacheKey].data);

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🛡 Proxy server running on http://localhost:${PORT}`);
});


