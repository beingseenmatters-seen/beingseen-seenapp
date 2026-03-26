import { API_BASE_URL, API_KEY } from '../config/api';

interface RequestOptions extends RequestInit {
  data?: any;
}

export async function apiClient(endpoint: string, options: RequestOptions = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Seen-App-Key')) {
    headers.set('X-Seen-App-Key', API_KEY);
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  if (options.data) {
    config.body = JSON.stringify(options.data);
  }

  console.log(`[API Client] Requesting ${options.method || 'GET'} ${url}`);

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API Client] Failed: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }
    
    // Some endpoints might return empty body or plain text, but we mostly expect JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    console.error(`[API Client] Network or parsing error for ${url}:`, error);
    throw error;
  }
}
