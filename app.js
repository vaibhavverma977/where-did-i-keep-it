/* =========================================================
   Where Did I Keep It? — V1
   Vanilla JS + IndexedDB. Everything stays on this device.
   (Second UI/UX pass — data model and behavior unchanged.)
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   Configuration
   --------------------------------------------------------- */

const DB_NAME = 'WhereDidIKeepItDB';
const DB_VERSION = 1;
const STORE_NAME = 'items';

const MAX_IMAGE_DIMENSION = 1600;
const THUMBNAIL_DIMENSION = 300;
const JPEG_QUALITY = 0.82;

/* ---------------------------------------------------------
   In-memory state
   --------------------------------------------------------- */

const state = {
  items: [],
  searchTerm: '',
  categoryFilter: '',
  editingId: null,
  existingItem: null,
  selectedPhotoBlob: null,
  selectedPhotoThumbBlob: null,
  selectedPhotoMimeType: null,
  photoRemoved: false
};

let db = null;

let listObjectUrls = [];
let formObjectUrl = null;
let photoProcessing = false;

/* ---------------------------------------------------------
   DOM references
   --------------------------------------------------------- */

const mainScreen = document.getElementById('main-screen');
const formScreen = document.getElementById('form-screen');

const searchInput = document.getElementById('search-input');
const categoryFilter = document.getElementById('category-filter');
const addItemBtn = document.getElementById('add-item-btn');
const itemsContainer = document.getElementById('items-container');
const emptyState = document.getElementById('empty-state');
const emptyStateText = document.getElementById('empty-state-text');
const emptyStateHint = document.getElementById('empty-state-hint');
const emptyStateAddBtn = document.getElementById('empty-state-add-btn');
const statusMessage = document.getElementById('status-message');

const backBtn = document.getElementById('back-btn');
const formTitle = document.getElementById('form-title');
const itemForm = document.getElementById('item-form');
const itemName = document.getElementById('item-name');
const itemCategory = document.getElementById('item-category');
const itemLocation = document.getElementById('item-location');
const itemNotes = document.getElementById('item-notes');
const categoryList = document.getElementById('category-list');

const pickPhotoBtn = document.getElementById('pick-photo-btn');
const photoInput = document.getElementById('item-photo');
const photoPreview = document.getElementById('photo-preview');
const photoPlaceholder = document.getElementById('photo-placeholder');
const removePhotoBtn = document.getElementById('remove-photo-btn');

const formError = document.getElementById('form-error');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const deleteBtn = document.getElementById('delete-btn');

/* =========================================================
   IndexedDB layer
   ========================================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;

    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
      };

      database.onversionchange = () => {
        database.close();
        db = null;
        setStatusMessage('Database was updated in another tab. Please reload.');
      };

      resolve(database);
    };

    request.onerror = () => reject(request.error);

    request.onblocked = () => {
      reject(new Error('Database is blocked. Close other tabs of this app and reload.'));
    };
  });
}

function dbAddItem(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.add(item);

    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error || new Error('Could not add item.'));
    tx.onabort = () => reject(tx.error || new Error('Add transaction aborted.'));
  });
}

function dbGetAllItems() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error || new Error('Read transaction aborted.'));
  });
}

function dbUpdateItem(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(item);

    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error || new Error('Could not update item.'));
    tx.onabort = () => reject(tx.error || new Error('Update transaction aborted.'));
  });
}

function dbDeleteItem(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not delete item.'));
    tx.onabort = () => reject(tx.error || new Error('Delete transaction aborted.'));
  });
}

/* =========================================================
   Photo processing
   ========================================================= */

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };

    img.src = url;
  });
}

function resizeToBlob(img, maxDimension, mimeType, quality) {
  return new Promise((resolve, reject) => {
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;

    if (!naturalWidth || !naturalHeight) {
      reject(new Error('Image has no dimensions.'));
      return;
    }

    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas is not supported in this browser.'));
      return;
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Image could not be processed.'));
        }
      },
      mimeType,
      quality
    );
  });
}

async function processPhotoFile(file) {
  if (!file) {
    throw new Error('No file selected.');
  }

  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const img = await loadImageFromFile(file);

  const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const quality = outputMime === 'image/jpeg' ? JPEG_QUALITY : undefined;

  const photoBlob = await resizeToBlob(img, MAX_IMAGE_DIMENSION, outputMime, quality);
  const photoThumbBlob = await resizeToBlob(img, THUMBNAIL_DIMENSION, outputMime, quality);

  return { photoBlob, photoThumbBlob, photoMimeType: outputMime };
}

/* =========================================================
   Object URL helpers
   ========================================================= */

function revokeListObjectUrls() {
  listObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  listObjectUrls = [];
}

function revokeFormObjectUrl() {
  if (formObjectUrl) {
    URL.revokeObjectURL(formObjectUrl);
    formObjectUrl = null;
  }
}

/* =========================================================
   Helpers
   ========================================================= */

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  return 'item-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

let statusTimer = null;

function setStatusMessage(message) {
  statusMessage.textContent = message;
  statusMessage.classList.remove('hidden');

  if (statusTimer) {
    clearTimeout(statusTimer);
  }

  statusTimer = setTimeout(() => {
    statusMessage.classList.add('hidden');
    statusTimer = null;
  }, 3500);
}

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove('hidden');
}

function hideFormError() {
  formError.textContent = '';
  formError.classList.add('hidden');
}

/* =========================================================
   SVG helpers (inline, no external deps)
   ========================================================= */

function createPinIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('item-location-icon');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '10');
  circle.setAttribute('r', '2.4');

  svg.appendChild(path);
  svg.appendChild(circle);

  return svg;
}

function createImagePlaceholderIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('item-thumb-placeholder-icon');

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '3');
  rect.setAttribute('y', '4');
  rect.setAttribute('width', '18');
  rect.setAttribute('height', '16');
  rect.setAttribute('rx', '3');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '9');
  circle.setAttribute('cy', '10');
  circle.setAttribute('r', '1.8');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M21 16l-5-5-9 8');

  svg.appendChild(rect);
  svg.appendChild(circle);
  svg.appendChild(path);

  return svg;
}

/* =========================================================
   Rendering
   ========================================================= */

function render() {
  renderCategoryOptions();
  renderItems();
  updateEmptyState();
}

function renderCategoryOptions() {
  const categories = new Set();

  state.items.forEach((item) => {
    const value = (item.category || '').trim();
    if (value) {
      categories.add(value);
    }
  });

  const sorted = Array.from(categories).sort((a, b) => a.localeCompare(b));

  const previous = categoryFilter.value;
  categoryFilter.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Categories';
  categoryFilter.appendChild(allOption);

  sorted.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });

  const stillValid = sorted.indexOf(previous) !== -1;
  categoryFilter.value = stillValid ? previous : '';
  state.categoryFilter = categoryFilter.value;

  categoryList.innerHTML = '';
  sorted.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    categoryList.appendChild(option);
  });
}

function getFilteredItems() {
  const term = state.searchTerm.trim().toLowerCase();
  const category = state.categoryFilter;

  return state.items
    .filter((item) => {
      if (category && (item.category || '').trim() !== category) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [
        item.name || '',
        item.category || '',
        item.location || '',
        item.notes || ''
      ]
        .join('\n')
        .toLowerCase();

      return haystack.indexOf(term) !== -1;
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function renderItems() {
  const oldUrls = listObjectUrls;
  listObjectUrls = [];

  const filtered = getFilteredItems();
  const fragment = document.createDocumentFragment();

  filtered.forEach((item) => {
    fragment.appendChild(buildItemCard(item));
  });

  itemsContainer.innerHTML = '';
  itemsContainer.appendChild(fragment);

  oldUrls.forEach((url) => URL.revokeObjectURL(url));
}

function buildItemCard(item) {
  const card = document.createElement('article');
  card.className = 'item-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'Edit ' + (item.name || 'item'));

  card.addEventListener('click', () => openEditForm(item.id));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      openEditForm(item.id);
    }
  });

  // --- Thumbnail ---
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'item-thumb-wrap';

  const thumbBlob = item.photoThumbBlob || item.photoBlob;

  if (thumbBlob instanceof Blob) {
    const img = document.createElement('img');
    img.className = 'item-thumb';
    img.alt = item.name ? 'Photo of ' + item.name : 'Item photo';
    img.loading = 'lazy';

    const url = URL.createObjectURL(thumbBlob);
    listObjectUrls.push(url);
    img.src = url;

    thumbWrap.appendChild(img);
  } else {
    thumbWrap.appendChild(createImagePlaceholderIcon());
  }

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'item-body';

  const name = document.createElement('h3');
  name.className = 'item-name';
  name.textContent = item.name || '(Untitled)';
  body.appendChild(name);

  const location = (item.location || '').trim();
  if (location) {
    const locRow = document.createElement('div');
    locRow.className = 'item-location';

    locRow.appendChild(createPinIcon());

    const locText = document.createElement('span');
    locText.className = 'item-location-text';
    locText.textContent = location;   // rendered exactly as stored — no "in " prefix
    locRow.appendChild(locText);

    body.appendChild(locRow);
  }

  const category = (item.category || '').trim();
  const notes = (item.notes || '').trim();

  if (category || notes) {
    const meta = document.createElement('div');
    meta.className = 'item-meta';

    if (category) {
      const cat = document.createElement('span');
      cat.className = 'item-category';
      cat.textContent = category;
      meta.appendChild(cat);
    }

    if (category && notes) {
      const sep = document.createElement('span');
      sep.className = 'item-meta-sep';
      sep.textContent = '·';
      meta.appendChild(sep);
    }

    if (notes) {
      const notesEl = document.createElement('span');
      notesEl.className = 'item-notes';
      notesEl.textContent = notes;
      notesEl.title = notes;
      meta.appendChild(notesEl);
    }

    body.appendChild(meta);
  }

  card.appendChild(thumbWrap);
  card.appendChild(body);

  return card;
}

function updateEmptyState() {
  const hasAnyItems = state.items.length > 0;
  const hasVisibleCards = itemsContainer.children.length > 0;

  if (!hasAnyItems) {
    emptyStateText.textContent = 'No items yet';
    emptyStateHint.textContent =
      "Start saving where you keep the things you don't want to lose.";
    emptyStateAddBtn.classList.remove('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  if (!hasVisibleCards) {
    emptyStateText.textContent = 'No matches found';
    emptyStateHint.textContent =
      'Try a different search term or clear the category filter.';
    emptyStateAddBtn.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
}

/* =========================================================
   Screen switching
   ========================================================= */

function showScreen(name) {
  if (name === 'form') {
    mainScreen.classList.add('hidden');
    formScreen.classList.remove('hidden');
    window.scrollTo(0, 0);
    return;
  }

  formScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  revokeFormObjectUrl();
}

/* =========================================================
   Photo preview inside the form
   ========================================================= */

function setFormPreview(blob) {
  revokeFormObjectUrl();

  if (blob instanceof Blob) {
    formObjectUrl = URL.createObjectURL(blob);
    photoPreview.src = formObjectUrl;
    photoPreview.classList.remove('hidden');
    photoPlaceholder.classList.add('hidden');
    removePhotoBtn.classList.remove('hidden');
  } else {
    photoPreview.removeAttribute('src');
    photoPreview.classList.add('hidden');
    photoPlaceholder.classList.remove('hidden');
    removePhotoBtn.classList.add('hidden');
  }
}

/* =========================================================
   Form open / close
   ========================================================= */

function resetFormPhotoState() {
  state.selectedPhotoBlob = null;
  state.selectedPhotoThumbBlob = null;
  state.selectedPhotoMimeType = null;
  state.photoRemoved = false;
  photoInput.value = '';
}

function openAddForm() {
  state.editingId = null;
  state.existingItem = null;
  resetFormPhotoState();

  formTitle.textContent = 'Add Item';
  itemName.value = '';
  itemCategory.value = '';
  itemLocation.value = '';
  itemNotes.value = '';

  hideFormError();
  setFormPreview(null);
  deleteBtn.classList.add('hidden');

  showScreen('form');
  itemName.focus();
}

function openEditForm(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  state.editingId = id;
  state.existingItem = item;
  resetFormPhotoState();

  formTitle.textContent = 'Edit Item';
  itemName.value = item.name || '';
  itemCategory.value = item.category || '';
  itemLocation.value = item.location || '';
  itemNotes.value = item.notes || '';

  hideFormError();
  setFormPreview(item.photoBlob instanceof Blob ? item.photoBlob : null);
  deleteBtn.classList.remove('hidden');

  showScreen('form');
  itemName.focus();
}

function closeForm() {
  state.editingId = null;
  state.existingItem = null;
  resetFormPhotoState();
  setFormPreview(null);
  hideFormError();
  showScreen('main');
}

/* =========================================================
   Data loading
   ========================================================= */

async function reloadItems() {
  const items = await dbGetAllItems();
  state.items = Array.isArray(items) ? items : [];
  render();
}

/* =========================================================
   Event handlers
   ========================================================= */

function bindEvents() {
  // --- Main screen ---
  searchInput.addEventListener('input', () => {
    state.searchTerm = searchInput.value;
    renderItems();
    updateEmptyState();
  });

  categoryFilter.addEventListener('change', () => {
    state.categoryFilter = categoryFilter.value;
    renderItems();
    updateEmptyState();
  });

  addItemBtn.addEventListener('click', openAddForm);
  emptyStateAddBtn.addEventListener('click', openAddForm);

  // --- Form navigation ---
  backBtn.addEventListener('click', closeForm);
  cancelBtn.addEventListener('click', closeForm);

  // --- Photo picker ---
  pickPhotoBtn.addEventListener('click', () => {
    if (photoProcessing) {
      return;
    }
    photoInput.click();
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) {
      return;
    }

    hideFormError();

    photoProcessing = true;
    saveBtn.disabled = true;

    try {
      const processed = await processPhotoFile(file);
      state.selectedPhotoBlob = processed.photoBlob;
      state.selectedPhotoThumbBlob = processed.photoThumbBlob;
      state.selectedPhotoMimeType = processed.photoMimeType;
      state.photoRemoved = false;
      setFormPreview(processed.photoBlob);
    } catch (err) {
      console.error(err);
      photoInput.value = '';
      showFormError(err && err.message ? err.message : 'Could not process that image.');
    } finally {
      photoProcessing = false;
      saveBtn.disabled = false;
    }
  });

  removePhotoBtn.addEventListener('click', () => {
    if (photoProcessing) {
      return;
    }
    state.selectedPhotoBlob = null;
    state.selectedPhotoThumbBlob = null;
    state.selectedPhotoMimeType = null;
    state.photoRemoved = true;
    photoInput.value = '';
    setFormPreview(null);
  });

  // --- Save ---
  itemForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (photoProcessing) {
      showFormError('Please wait for the photo to finish processing.');
      return;
    }

    hideFormError();

    const name = itemName.value.trim();
    if (!name) {
      showFormError('Item name is required.');
      itemName.focus();
      return;
    }

    const category = itemCategory.value.trim();
    const location = itemLocation.value.trim();
    const notes = itemNotes.value.trim();

    let photoBlob = null;
    let photoThumbBlob = null;
    let photoMimeType = null;

    if (state.selectedPhotoBlob instanceof Blob) {
      photoBlob = state.selectedPhotoBlob;
      photoThumbBlob = state.selectedPhotoThumbBlob;
      photoMimeType = state.selectedPhotoMimeType;
    } else if (
      state.editingId &&
      state.existingItem &&
      !state.photoRemoved &&
      state.existingItem.photoBlob instanceof Blob
    ) {
      photoBlob = state.existingItem.photoBlob;
      photoThumbBlob = state.existingItem.photoThumbBlob || null;
      photoMimeType = state.existingItem.photoMimeType || null;
    }

    const now = Date.now();
    const isEditing = Boolean(state.editingId);

    try {
      if (isEditing) {
        const existing = state.existingItem;
        const updated = {
          id: existing.id,
          name: name,
          category: category,
          location: location,
          notes: notes,
          photoBlob: photoBlob,
          photoThumbBlob: photoThumbBlob,
          photoMimeType: photoMimeType,
          createdAt: existing.createdAt || now,
          updatedAt: now
        };

        await dbUpdateItem(updated);
      } else {
        const item = {
          id: createId(),
          name: name,
          category: category,
          location: location,
          notes: notes,
          photoBlob: photoBlob,
          photoThumbBlob: photoThumbBlob,
          photoMimeType: photoMimeType,
          createdAt: now,
          updatedAt: now
        };

        await dbAddItem(item);
      }

      await reloadItems();

      state.editingId = null;
      state.existingItem = null;
      resetFormPhotoState();
      setFormPreview(null);

      showScreen('main');
      setStatusMessage(isEditing ? 'Item updated.' : 'Item saved.');
    } catch (err) {
      console.error(err);
      showFormError(
        'Could not save the item. ' + (err && err.message ? err.message : 'Please try again.')
      );
    }
  });

  // --- Delete ---
  deleteBtn.addEventListener('click', async () => {
    if (!state.editingId) {
      return;
    }

    const item = state.items.find((entry) => entry.id === state.editingId);
    const label = item && item.name ? '“' + item.name + '”' : 'this item';

    if (!window.confirm('Delete ' + label + '? This cannot be undone.')) {
      return;
    }

    try {
      await dbDeleteItem(state.editingId);
      await reloadItems();

      state.editingId = null;
      state.existingItem = null;
      resetFormPhotoState();
      setFormPreview(null);

      showScreen('main');
      setStatusMessage('Item deleted.');
    } catch (err) {
      console.error(err);
      showFormError('Could not delete the item. Please try again.');
    }
  });

  // --- Cleanup on page hide ---
  window.addEventListener('pagehide', () => {
    revokeListObjectUrls();
    revokeFormObjectUrl();
  });
}

/* =========================================================
   Startup
   ========================================================= */

async function init() {
  bindEvents();

  try {
    db = await openDatabase();
    await reloadItems();
  } catch (err) {
    console.error('Failed to initialise local storage:', err);
    setStatusMessage(
      'Local storage could not be opened. Your browser may be blocking IndexedDB ' +
        '(for example in private browsing mode).'
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}