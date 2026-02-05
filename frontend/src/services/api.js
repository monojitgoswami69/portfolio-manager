/**
 * API Service for Admin Backend
 * Handles all HTTP requests to the FastAPI backend
 */

// Base URL - use environment variable or default to localhost
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }

  get isServerError() {
    return this.status >= 500;
  }

  get isNetworkError() {
    return this.status === 0;
  }
}

// Storage keys (must match AuthContext)
const TOKEN_STORAGE_KEY = 'admin_token';

/**
 * Get JWT token from storage (sessionStorage or localStorage)
 */
function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Get session object for backward compatibility
 * Returns an object with token property
 */
function getSession() {
  const token = getToken();
  return token ? { token } : null;
}

/**
 * Update token if server issued a new one (sliding expiration)
 */
function handleTokenRefresh(response) {
  const newToken = response.headers.get('X-New-Token');
  if (newToken) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    console.log('Token refreshed via sliding expiration');
  }
}

/**
 * Check if we're in demo mode (test user)
 */
function isDemoMode() {
  const token = getToken();
  return token === 'TEST_TOKEN_DEMO_MODE';
}

/**
 * Get mock response for demo mode
 */
async function getMockResponse(endpoint) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

  // Dashboard endpoints
  if (endpoint.includes('/dashboard/stats')) {
    return {
      status: 'success',
      total_documents: 0,
      total_queries: 0,
      storage_used_mb: 0,
      active_users: 0
    };
  }

  if (endpoint.includes('/dashboard/activity')) {
    return {
      status: 'success',
      activities: []
    };
  }

  if (endpoint.includes('/dashboard/weekly')) {
    return {
      status: 'success'
    };
  }

  // Knowledge base endpoints
  if (endpoint.includes('/knowledge-base/files')) {
    return {
      status: 'success',
      documents: [],
      total: 0
    };
  }

  // Archive endpoints
  if (endpoint.includes('/archive')) {
    return {
      status: 'success',
      files: [],
      documents: [],
      total: 0
    };
  }

  // System instructions
  if (endpoint.includes('/system-instructions')) {
    return {
      status: 'success',
      content: ''
    };
  }

  // Users endpoint
  if (endpoint.includes('/users')) {
    return {
      status: 'success',
      users: [
        { uid: 'test_uid', username: 'test', email: 'test@example.com', role: 'admin', status: 'active' }
      ],
      total: 1
    };
  }

  // Bot settings
  if (endpoint.includes('/bot-settings') || endpoint.includes('/chatbot')) {
    return {
      status: 'success',
      settings: {},
      bot_name: 'Demo Bot',
      welcome_message: 'Welcome to demo mode!'
    };
  }

  // Query analytics
  if (endpoint.includes('/analytics') || endpoint.includes('/queries')) {
    return {
      status: 'success',
      queries: [],
      total: 0
    };
  }

  // Default response
  return { status: 'success', data: [] };
}

/**
 * Make an API request with authentication
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getToken();
  const method = (options.method || 'GET').toUpperCase();

  // Check for demo mode - return mock responses
  if (isDemoMode()) {
    console.log('[Demo Mode] Mock response for:', endpoint);
    return getMockResponse(endpoint);
  }

  try {
    const headers = {
      ...options.headers,
    };

    // Add auth header if token exists
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers,
    });

    return handleResponse(response);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network error or server down
    throw new ApiError(error.message || 'Network error', 0, { originalError: error });
  }
}

async function handleResponse(response) {
  // Check for token refresh (sliding expiration)
  handleTokenRefresh(response);

  if (!response.ok) {
    // Handle 401 - token expired, clear session
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem('admin_user_info');
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.detail || `HTTP ${response.status}`,
      response.status,
      errorData
    );
  }

  return await response.json();
}

// ============================================
// Health & Dashboard API
// ============================================

export const healthApi = {
  /**
   * Check server health
   */
  async check() {
    // In demo mode, always return true
    if (isDemoMode()) {
      return true;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Get dashboard stats (requires auth)
   */
  async getStats() {
    return apiRequest('/api/v1/dashboard/stats');
  },

  /**
   * Get recent activity
   */
  async getActivity(limit = 20) {
    return apiRequest(`/api/v1/dashboard/activity?limit=${limit}`);
  },

  /**
   * Get weekly activity data
   */
  async getWeeklyActivity() {
    return apiRequest('/api/v1/dashboard/weekly');
  },
};

// ============================================
// Knowledge Base API
// ============================================

export const knowledgeBaseApi = {
  /**
   * List all active documents
   */
  async list(limit = 500) {
    return apiRequest(`/api/v1/knowledge-base/files?limit=${limit}`);
  },

  // Alias for backwards compatibility
  async listDocuments(limit = 500) {
    return this.list(limit);
  },

  /**
   * Get a single document by ID
   */
  async get(documentId) {
    return apiRequest(`/api/v1/knowledge-base/document/${documentId}`);
  },

  // Alias
  async getDocument(documentId) {
    return this.get(documentId);
  },

  /**
   * Download document content as blob
   */
  async download(documentId) {
    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/v1/knowledge-base/download/${documentId}`,
      { headers }
    );

    // Check for token refresh
    handleTokenRefresh(response);

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Download failed', response.status);
    }

    return response.blob();
  },

  // Alias
  async downloadDocument(documentId) {
    return this.download(documentId);
  },

  /**
   * Get document content as text for preview
   */
  async getContent(documentId) {
    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/v1/knowledge-base/download/${documentId}`,
      { headers }
    );

    // Check for token refresh
    handleTokenRefresh(response);

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Failed to get content', response.status);
    }

    return response.text();
  },

  /**
   * Preview document content (returns blob URL for rendering)
   */
  async preview(documentId) {
    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/v1/knowledge-base/preview/${documentId}`,
      { headers }
    );

    // Check for token refresh
    handleTokenRefresh(response);

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Failed to get preview', response.status);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },

  /**
   * Archive a document
   */
  async archive(documentId, filename = null) {
    return apiRequest('/api/v1/knowledge-base/archive', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, filename }),
    });
  },

  // Alias
  async archiveDocument(documentId, filename = null) {
    return this.archive(documentId, filename);
  },

  /**
   * Edit/reindex a document
   */
  async edit(documentId, content) {
    return apiRequest('/api/v1/knowledge-base/edit', {
      method: 'PUT',
      body: JSON.stringify({ document_id: documentId, content }),
    });
  },

  // Alias
  async editDocument(documentId, content) {
    return this.edit(documentId, content);
  },

  /**
   * Permanently delete a document
   */
  async delete(documentId) {
    return apiRequest(`/api/v1/knowledge-base/document/${documentId}`, {
      method: 'DELETE',
    });
  },

  // Alias
  async deleteDocument(documentId) {
    return this.delete(documentId);
  },
};

// ============================================
// Upload API
// ============================================

export const uploadApi = {
  /**
   * Upload a single file with status callbacks
   * @param {File} file - File to upload
   * @param {Object} options - Optional metadata
   * @param {Function} onStatusChange - Callback for status updates (status, progress)
   */
  async file(file, options = {}, onStatusChange = null) {
    // Demo mode - simulate upload
    if (isDemoMode()) {
      return new Promise((resolve) => {
        if (onStatusChange) onStatusChange('uploading', 10);
        setTimeout(() => {
          if (onStatusChange) onStatusChange('uploading', 50);
          setTimeout(() => {
            if (onStatusChange) onStatusChange('processing', 80);
            setTimeout(() => {
              if (onStatusChange) onStatusChange('complete', 100);
              resolve({
                status: 'success',
                document_id: 'demo_' + Date.now(),
                filename: file.name,
                message: '[Demo Mode] File upload simulated'
              });
            }, 300);
          }, 300);
        }, 300);
      });
    }

    const formData = new FormData();
    formData.append('file', file);

    // Add optional metadata
    if (options.title) formData.append('title', options.title);
    if (options.source) formData.append('source', options.source);
    if (options.tags) formData.append('tags', JSON.stringify(options.tags));

    // Backend doesn't support streaming, use standard upload with progress callbacks

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onStatusChange) {
          const uploadProgress = Math.round((e.loaded / e.total) * 30); // Upload is 0-30%
          onStatusChange('uploading', uploadProgress);
        }
      });

      xhr.addEventListener('load', () => {
        // Check for token refresh
        const newToken = xhr.getResponseHeader('X-New-Token');
        if (newToken) {
          sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
          console.log('Token refreshed via sliding expiration (upload)');
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (onStatusChange) onStatusChange('complete', 100);
            resolve(result);
          } catch {
            reject(new ApiError('Invalid response', xhr.status));
          }
        } else if (xhr.status === 401) {
          // Token expired
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          sessionStorage.removeItem('admin_user_info');
          window.dispatchEvent(new CustomEvent('auth:expired'));
          reject(new ApiError('Session expired', 401));
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new ApiError(errorData.detail || 'Upload failed', xhr.status, errorData));
          } catch {
            reject(new ApiError(xhr.statusText || 'Upload failed', xhr.status));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new ApiError('Network error', 0));
      });

      xhr.open('POST', `${API_BASE_URL}/api/v1/upload`);
      const token = getToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  },

  /**
   * Upload multiple files sequentially (backend only supports single file upload)
   * @param {File[]} files - Array of files
   * @param {Object} options - Optional metadata
   * @param {Function} onStatusChange - Callback for status updates (status, progress, fileIndex)
   */
  async multiple(files, options = {}, onStatusChange = null) {
    const results = [];
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const overallProgress = Math.round((i / files.length) * 100);

      if (onStatusChange) {
        onStatusChange('uploading', overallProgress, i);
      }

      try {
        const result = await this.file(file, options, (status, fileProgress) => {
          // Convert individual file progress to overall progress
          const totalProgress = Math.round((i / files.length) * 100 + (fileProgress / files.length));
          if (onStatusChange) {
            onStatusChange('uploading', totalProgress, i);
          }
        });

        results.push({ file: file.name, success: true, ...result });
        successCount++;

        if (onStatusChange) {
          onStatusChange('complete', Math.round(((i + 1) / files.length) * 100), i);
        }
      } catch (error) {
        results.push({ file: file.name, success: false, error: error.message });
        if (onStatusChange) {
          onStatusChange('error', overallProgress, i);
        }
      }
    }

    return {
      status: 'success',
      total: files.length,
      successful: successCount,
      failed: files.length - successCount,
      results
    };
  },

  /**
   * Upload archive - archives are not supported, throw error
   */
  async uploadArchive(file, options = {}, onStatusChange = null) {
    throw new ApiError('Archive uploads are not supported in this configuration', 400);
  },
};

// ============================================
// Text Processing API
// ============================================

export const textApi = {
  /**
   * Process text (clean and chunk preview)
   * @param {string} text - Text to process
   */
  async process(text) {
    return apiRequest('/api/v1/text/process', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  /**
   * Upload processed text to knowledge base
   * @param {string} filename - Name for the document
   * @param {string} content - Text content
   * @param {Function} onStatusChange - Callback for status updates
   */
  async upload(filename, content, onStatusChange = null) {
    if (onStatusChange) onStatusChange('uploading', 10);

    try {
      if (onStatusChange) onStatusChange('processing', 30);

      const result = await apiRequest('/api/v1/text/upload', {
        method: 'POST',
        body: JSON.stringify({ filename, content }),
      });

      // Simulate processing stages
      if (onStatusChange) {
        setTimeout(() => onStatusChange('embedding', 70), 100);
        setTimeout(() => onStatusChange('storing', 90), 300);
        setTimeout(() => onStatusChange('complete', 100), 500);
      }

      return result;
    } catch (error) {
      if (onStatusChange) onStatusChange('error', 0);
      throw error;
    }
  },
};

// ============================================
// Archive API
// ============================================

export const archiveApi = {
  /**
   * List archived files
   */
  async list(limit = 100) {
    const response = await apiRequest(`/api/v1/archive?limit=${limit}`);
    // Backend returns 'files' but normalize to 'documents' for consistency
    if (response.files && !response.documents) {
      response.documents = response.files;
    }
    return response;
  },

  // Alias for backward compatibility
  async listArchived(limit = 100) {
    return this.list(limit);
  },

  /**
   * Restore an archived document
   */
  async restore(archiveId) {
    return apiRequest('/api/v1/archive/restore', {
      method: 'POST',
      body: JSON.stringify({ archive_id: archiveId }),
    });
  },

  /**
   * Permanently delete from archive
   */
  async delete(archiveId) {
    return apiRequest(`/api/v1/knowledge-base/document/${archiveId}`, {
      method: 'DELETE',
    });
  },

  // Alias for backward compatibility
  async deletePermanent(archiveId) {
    return this.delete(archiveId);
  },

  /**
   * Download archived document as blob
   */
  async download(archiveId) {
    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Backend uses same download endpoint for both active and archived documents
    const response = await fetch(
      `${API_BASE_URL}/api/v1/knowledge-base/download/${archiveId}`,
      { headers }
    );

    // Check for token refresh
    handleTokenRefresh(response);

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Download failed', response.status);
    }

    return response;
  },

  /**
   * Get archived document content as text for preview
   */
  async getContent(archiveId) {
    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Backend uses same download endpoint for both active and archived documents
    const response = await fetch(
      `${API_BASE_URL}/api/v1/knowledge-base/download/${archiveId}`,
      { headers }
    );

    // Check for token refresh
    handleTokenRefresh(response);

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Failed to get content', response.status);
    }

    return response.text();
  },

  /**
   * Preview archived document (returns blob URL for rendering)
   */
  async preview(archiveId) {
    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Backend uses same preview endpoint for both active and archived documents
    const response = await fetch(
      `${API_BASE_URL}/api/v1/knowledge-base/preview/${archiveId}`,
      { headers }
    );

    // Check for token refresh
    handleTokenRefresh(response);

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Failed to get preview', response.status);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },

  /**
   * Trigger manual cleanup
   */
  async cleanup(days = null) {
    const url = days ? `/api/v1/archive/cleanup?days=${days}` : '/api/v1/archive/cleanup';
    return apiRequest(url, {
      method: 'DELETE',
    });
  },
};

// ============================================
// System Instructions API
// ============================================

export const systemInstructionsApi = {
  /**
   * Get current system instructions
   */
  async get() {
    return apiRequest('/api/v1/system-instructions');
  },

  /**
   * Save system instructions
   */
  async save(content, message = null) {
    return apiRequest('/api/v1/system-instructions/save', {
      method: 'POST',
      body: JSON.stringify({ content, message }),
    });
  },
};

// ============================================
// Export all APIs - both named and default
// ============================================

// Auth API
export const authApi = {
  /**
   * Login with credentials
   */
  async login(username, password) {
    const result = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (result.status === 'success' && result.user) {
      localStorage.setItem('admin_session', JSON.stringify(result.user));
    }

    return result;
  },

  /**
   * Logout
   */
  async logout() {
    localStorage.removeItem('admin_session');
    return { status: 'success' };
  },

  /**
   * Check if session is valid
   */
  isLoggedIn() {
    return !!getToken();
  },

  /**
   * Get current token
   */
  getToken() {
    return getToken();
  },

  /**
   * Get current session (backward compatibility)
   */
  getSession() {
    return getSession();
  },
};

// ============================================
// User Management API (Superuser only)
// ============================================

export const userApi = {
  /**
   * List all users in the organization (superuser only)
   * @returns {Promise<{status: string, users: Array, total: number}>}
   */
  async list() {
    return apiRequest('/api/v1/users');
  },

  /**
   * Get a specific user by ID
   * @param {string} userId - User ID to retrieve
   */
  async get(userId) {
    return apiRequest(`/api/v1/users/${encodeURIComponent(userId)}`);
  },

  /**
   * Create a new user in the organization (superuser only)
   * @param {Object} userData - User data
   * @param {string} userData.username - Username (3-50 chars, alphanumeric + underscore/hyphen)
   * @param {string} userData.email - Email address
   * @param {string} userData.password - Password (min 8 chars)
   * @param {string} [userData.full_name] - Full name (optional)
   * @param {string} [userData.role] - Role: 'admin', 'viewer', or 'analyser' (default: 'admin')
   */
  async create(userData) {
    return apiRequest('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  /**
   * Update a user's information (superuser only)
   * @param {string} userId - User ID to update
   * @param {Object} updateData - Fields to update
   * @param {string} [updateData.full_name] - New full name
   * @param {string} [updateData.role] - New role
   * @param {string} [updateData.status] - 'active' or 'disabled'
   */
  async update(userId, updateData) {
    return apiRequest(`/api/v1/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });
  },

  /**
   * Delete a user (superuser only)
   * @param {string} userId - User ID to delete
   */
  async delete(userId) {
    return apiRequest(`/api/v1/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Reset a user's password (superuser only)
   * @param {string} userId - User ID
   * @param {string} newPassword - New password (min 8 chars)
   */
  async resetPassword(userId, newPassword) {
    return apiRequest(`/api/v1/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    });
  },
};

export const api = {
  auth: authApi,
  health: healthApi,
  documents: knowledgeBaseApi,  // Alias for consistency
  knowledgeBase: knowledgeBaseApi,
  upload: {
    file: uploadApi.file,
    multiple: uploadApi.multiple,
    archive: uploadApi.uploadArchive,
  },
  text: textApi,
  archive: archiveApi,
  systemInstructions: systemInstructionsApi,
  users: userApi,  // User management API (superuser only)
  dashboard: {
    getStats: () => apiRequest('/api/v1/dashboard/stats'),
    getActivity: (limit = 10) => apiRequest(`/api/v1/dashboard/activity?limit=${limit}`),
    getWeekly: () => apiRequest('/api/v1/dashboard/weekly'),
  },
  /**
   * Chatbot Knowledge Base API
   * For managing the 5 knowledge categories used by NEXUS chatbot
   */
  chatbotKnowledge: {
    /**
     * Get all knowledge categories
     * @returns {Promise<{status: string, categories: Object}>}
     */
    getAll: async () => {
      return apiRequest('/api/v1/knowledge');
    },

    /**
     * Get list of valid category names
     * @returns {Promise<{status: string, categories: string[]}>}
     */
    getCategories: async () => {
      return apiRequest('/api/v1/knowledge/categories');
    },

    /**
     * Get content for a specific category
     * @param {string} category - Category ID (about-me, tech-stack, projects, contacts, miscellaneous)
     * @returns {Promise<{status: string, category: string, data: Object}>}
     */
    get: async (category) => {
      return apiRequest(`/api/v1/knowledge/${encodeURIComponent(category)}`);
    },

    /**
     * Save content for a specific category
     * @param {string} category - Category ID
     * @param {string} content - New content
     * @returns {Promise<{status: string, message: string}>}
     */
    save: async (category, content) => {
      return apiRequest(`/api/v1/knowledge/${encodeURIComponent(category)}/save`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    },
  },
  /**
   * NEXUS Chat API (Public - No Auth Required)
   * For interacting with the NEXUS chatbot
   */
  chat: {
    /**
     * Send a message to NEXUS chatbot
     * @param {string} message - User message
     * @param {string} [sessionId] - Optional session ID for conversation tracking
     * @returns {Promise<{status: string, response: string, timestamp: string, cached: boolean}>}
     */
    send: async (message, sessionId = null) => {
      // Public endpoint - no auth required
      const response = await fetch(`${API_BASE_URL}/api/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: sessionId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.detail || `Chat failed: HTTP ${response.status}`,
          response.status,
          errorData
        );
      }
      
      return response.json();
    },

    /**
     * Check chat endpoint health
     * @returns {Promise<{status: string, genai_available: boolean, cache_stale: boolean}>}
     */
    health: async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/chat/health`);
      return response.json();
    },
  },
  /**
   * Contacts API
   * For managing contact information (email and social links)
   */
  contacts: {
    /**
     * Get contact information
     * @returns {Promise<{status: string, contact: Object, commit: string}>}
     */
    get: async () => {
      return apiRequest('/api/v1/contacts');
    },

    /**
     * Save contact information
     * @param {Object} contact - Contact data with email and socials
     * @param {string} [message] - Optional commit message
     * @returns {Promise<{status: string, message: string, commit: string}>}
     */
    save: async (contact, message = null) => {
      return apiRequest('/api/v1/contacts/save', {
        method: 'POST',
        body: JSON.stringify({ contact, message }),
      });
    },
  },
  /**
   * Projects API
   * For managing portfolio projects
   */
  projects: {
    /**
     * Get all projects
     * @returns {Promise<{status: string, projects: Array, commit: string}>}
     */
    get: async () => {
      return apiRequest('/api/v1/projects');
    },

    /**
     * Save projects list
     * @param {Array} projects - Array of project objects
     * @param {string} [message] - Optional commit message
     * @returns {Promise<{status: string, message: string, commit: string}>}
     */
    save: async (projects, message = null) => {
      return apiRequest('/api/v1/projects/save', {
        method: 'POST',
        body: JSON.stringify({ projects, message }),
      });
    },

    /**
     * Upload and process a project image
     * @param {File} file - Image file to upload
     * @param {string} projectName - Project name for filename generation
     * @returns {Promise<{status: string, imageUrl: string, filename: string}>}
     */
    uploadImage: async (file, projectName) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectName', projectName);

      return apiRequest('/api/v1/projects/upload-image', {
        method: 'POST',
        body: formData,
      });
    },
  },
  /**
   * Handoff Management API
   * For managing human handoff requests from the chatbot
   */
  handoffs: {
    /**
     * List handoff requests for the organization
     * @param {Object} options - Query options
     * @param {string} [options.status] - Filter by status: 'pending', 'answered', 'dismissed'
     * @param {number} [options.limit] - Maximum results (default: 100)
     * @returns {Promise<{status: string, handoffs: Array, count: number}>}
     */
    list: async (options = {}) => {
      const params = new URLSearchParams();
      if (options.status) params.append('status', options.status);
      if (options.limit) params.append('limit', options.limit);
      const queryString = params.toString();
      return apiRequest(`/api/v1/handoffs${queryString ? `?${queryString}` : ''}`);
    },

    /**
     * Get handoff statistics
     * @returns {Promise<{status: string, stats: {total: number, pending: number, answered: number, dismissed: number}}>}
     */
    getStats: async () => {
      return apiRequest('/api/v1/handoffs/stats');
    },

    /**
     * Get a specific handoff by ID
     * @param {string} handoffId - Handoff ID
     * @returns {Promise<{status: string, handoff: Object}>}
     */
    get: async (handoffId) => {
      return apiRequest(`/api/v1/handoffs/${encodeURIComponent(handoffId)}`);
    },

    /**
     * Answer a pending handoff request
     * @param {string} handoffId - Handoff ID
     * @param {string} answer - Human-provided answer
     * @returns {Promise<{status: string, message: string, handoff_id: string}>}
     */
    answer: async (handoffId, answer) => {
      return apiRequest(`/api/v1/handoffs/${encodeURIComponent(handoffId)}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });
    },

    /**
     * Dismiss a pending handoff request
     * @param {string} handoffId - Handoff ID
     * @param {string} [reason] - Optional reason for dismissal
     * @returns {Promise<{status: string, message: string, handoff_id: string}>}
     */
    dismiss: async (handoffId, reason = null) => {
      return apiRequest(`/api/v1/handoffs/${encodeURIComponent(handoffId)}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    },
  },
  /**
   * Batch download multiple documents as a ZIP file
   * @param {string[]} documentIds - Array of document IDs to download
   * @param {string} source - 'knowledge-base' or 'archive'
   */
  async batchDownload(documentIds, source = 'knowledge-base') {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/batch-download`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ document_ids: documentIds, source }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem('admin_user_info');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new ApiError('Batch download failed', response.status);
    }

    return response.blob();
  },
  /**
   * Legacy method for answering queries - now uses handoffs API
   * @deprecated Use api.handoffs.answer() instead
   */
  answerQuery: async (queryId, data) => {
    return apiRequest(`/api/v1/handoffs/${encodeURIComponent(queryId)}/answer`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

export default api;

