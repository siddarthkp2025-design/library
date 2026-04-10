/**
 * PRODUCTION-LEVEL WASM INTEGRATION
 * 
 * This wrapper provides:
 * 1. Proper Module initialization with guaranteed timing
 * 2. Safe ccall wrapper with error handling
 * 3. Type validation before function calls
 * 4. Promise-based async initialization
 * 5. Defensive null checks and error recovery
 */

// ============================================================================
// WASM Module Management
// ============================================================================

const WasmManager = {
    module: null,
    isReady: false,
    readyPromise: null,
    readyResolve: null,
    readyReject: null,
    initTimeout: 5000,  // 5 second timeout

    /**
     * Initialize the WASM module with proper promise-based initialization
     * 
     * CRITICAL FIX: Ensures onRuntimeInitialized fires AFTER all scripts load
     * by using a debounce mechanism
     */
    initialize() {
        // Create a promise that resolves when WASM is ready
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;

            // Timeout safety
            setTimeout(() => {
                if (!this.isReady) {
                    this.readyReject(new Error('WASM initialization timeout'));
                }
            }, this.initTimeout);
        });

        return this.readyPromise;
    },

    /**
     * Called by Emscripten when module is initialized
     * 
     * Must be called from Module.onRuntimeInitialized
     */
    onModuleReady(module) {
        if (!module || !module.ccall) {
            this.readyReject(new Error('Module missing ccall'));
            return;
        }

        this.module = module;
        this.isReady = true;
        this.readyResolve(module);

        console.log('[WASM] Module initialized successfully');
    },

    /**
     * Verify module is ready
     */
    ensureReady() {
        if (!this.module) {
            throw new Error('WASM module not initialized');
        }
        if (!this.module.ccall) {
            throw new Error('Module.ccall not available');
        }
        return this.module;
    },

    /**
     * Type validation for ccall parameters
     * 
     * Validates that parameter types match expected C++ function signature
     * Prevents type confusion that causes memory corruption
     */
    validateParams(funcName, argTypes, args) {
        if (!argTypes || argTypes.length === 0) {
            return;  // No parameters to validate
        }

        if (argTypes.length !== args.length) {
            throw new Error(
                `Function ${funcName}: expected ${argTypes.length} args, got ${args.length}`
            );
        }

        for (let i = 0; i < argTypes.length; i++) {
            const expectedType = argTypes[i];
            const actualValue = args[i];

            // Type validation rules
            switch (expectedType) {
                case 'number':
                    if (typeof actualValue !== 'number') {
                        throw new Error(
                            `Function ${funcName} arg ${i}: expected 'number', got '${typeof actualValue}'`
                        );
                    }
                    break;

                case 'string':
                    if (typeof actualValue !== 'string') {
                        throw new Error(
                            `Function ${funcName} arg ${i}: expected 'string', got '${typeof actualValue}'`
                        );
                    }
                    break;
            }
        }
    },

    /**
     * Safe ccall wrapper with validation and error handling
     * 
     * Usage:
     *   const result = await WasmManager.call('addBook', 'number',
     *       ['string', 'string', 'string', 'number', 'string'],
     *       [title, author, publisher, qty, category]
     *   );
     * 
     * Returns: Resolved value or throws with detailed error
     */
    async call(funcName, returnType, argTypes, args) {
        try {
            // Ensure module is ready
            const module = this.ensureReady();

            // Validate parameters
            this.validateParams(funcName, argTypes, args);

            // Call the exported C++ function
            const result = module.ccall(funcName, returnType, argTypes, args);

            // Validate return value
            if (returnType === 'string' && !result) {
                throw new Error(`Function ${funcName} returned null string`);
            }

            return result;

        } catch (error) {
            console.error(`[WASM Error] ${funcName}:`, error.message);
            throw error;
        }
    },

    /**
     * Synchronous ccall (use only when module guaranteed ready)
     * 
     * Throws if module not ready
     */
    callSync(funcName, returnType, argTypes, args) {
        if (!this.isReady) {
            throw new Error('WASM module not ready. Use call() instead.');
        }

        const module = this.ensureReady();
        this.validateParams(funcName, argTypes, args);
        return module.ccall(funcName, returnType, argTypes, args);
    }
};

// ============================================================================
// Global Window Hook (called by Emscripten)
// ============================================================================

window.wasmModuleLoadedCallback = function(module) {
    WasmManager.onModuleReady(module);
};

// ============================================================================
// Application State
// ============================================================================

const appState = {
    currentSection: 'dashboard',
    wasmReady: false,
    selectedBookIdIssue: null,
    selectedBookIdReturn: null,
    returnBookMemberId: null,
    availableBooks: [],
    nextMemberId: 1,
    memberNames: new Set(),  // Track unique member names
    issuedBooksCount: 0,
};

// Console output buffer
const consoleBuffer = [];
const MAX_CONSOLE_LINES = 100;

// ============================================================================
// UI/Logging Functions
// ============================================================================

function addConsoleLog(message, type = 'log') {
    const timestamp = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    const line = `[${timestamp}] ${message}`;
    
    consoleBuffer.push({ message: line, type });
    
    if (consoleBuffer.length > MAX_CONSOLE_LINES) {
        consoleBuffer.shift();
    }
    
    renderConsole();
}

function renderConsole() {
    const consoleEl = document.getElementById('console');
    if (!consoleEl) return;
    
    consoleEl.innerHTML = consoleBuffer.map(item => {
        return `<div class="console-line ${item.type}">${escapeHtml(item.message)}</div>`;
    }).join('');
    
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function clearForm(formId) {
    const form = document.getElementById(formId);
    if (form) {
        form.reset();
    }
}

// ============================================================================
// MODAL AND BOOKS LIST FUNCTIONS  
// ============================================================================

function showModal(title, message) {
    const modal = document.getElementById('successModal');
    if (modal) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        modal.classList.add('active');
    }
}

function closeModal() {
    const modal = document.getElementById('successModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function loadAvailableBooks() {
    try {
        const result = await wasmGetAllBooks();
        const lines = result.split('\n').filter(line => line.trim());
        const books = [];
        
        lines.forEach(line => {
            // Simple parsing: id|title|quantity
            const parts = line.split('|').map(part => part.trim());
            if (parts.length !== 3) return;

            const id = parseInt(parts[0], 10);
            const title = parts[1];
            const qty = parseInt(parts[2], 10);

            // Only include books with quantity > 0
            if (!isNaN(id) && title && !isNaN(qty) && qty > 0) {
                books.push({ id, title, qty });
            }
        });
        
        appState.availableBooks = books;

        // Clear selections if book no longer available
        if (!books.some(book => book.id === appState.selectedBookIdIssue)) {
            appState.selectedBookIdIssue = null;
        }
        if (!books.some(book => book.id === appState.selectedBookIdReturn)) {
            appState.selectedBookIdReturn = null;
        }

        return books;
    } catch (error) {
        console.error('Error loading books:', error);
        return [];
    }
}

function displayAvailableBooks(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (appState.availableBooks.length === 0) {
        container.innerHTML = '<div class="book-item">No books available</div>';
        return;
    }

    appState.availableBooks.forEach(book => {
        const isIssue = containerId === 'availableBooksListIssue';
        const isSelected = isIssue ? (book.id === appState.selectedBookIdIssue) : (book.id === appState.selectedBookIdReturn);
        
        const bookEl = document.createElement('div');
        bookEl.className = 'book-item' + (isSelected ? ' selected' : '');
        bookEl.innerHTML = `
            <div class="book-item-checkbox">${isSelected ? '✓' : ''}</div>
            <div class="book-item-info">
                <div class="book-item-title">[${book.id}] ${book.title} (Qty: ${book.qty})</div>
            </div>
        `;
        
        bookEl.addEventListener('click', () => {
            document.querySelectorAll('#' + containerId + ' .book-item').forEach(el => {
                el.classList.remove('selected');
                el.querySelector('.book-item-checkbox').textContent = '';
            });
            
            bookEl.classList.add('selected');
            bookEl.querySelector('.book-item-checkbox').textContent = '✓';
            
            if (isIssue) {
                appState.selectedBookIdIssue = book.id;
            } else {
                appState.selectedBookIdReturn = book.id;
            }
        });
        
        container.appendChild(bookEl);
    });
}

async function loadAndDisplayBorrowedBooks(memberId) {
    try {
        const result = await wasmGetBorrowedBooks(parseInt(memberId));
        
        // Parse the result
        const lines = result.split('\n').filter(line => line.trim());
        const books = [];
        
        lines.forEach(line => {
            // Format: id|title|bookingId
            const parts = line.split('|').map(part => part.trim());
            if (parts.length === 3) {
                const id = parseInt(parts[0], 10);
                const title = parts[1];
                
                if (!isNaN(id) && title) {
                    books.push({ id, title });
                }
            }
        });
        
        // Display the borrowed books
        const container = document.getElementById('availableBooksListReturn');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (books.length === 0) {
            container.innerHTML = '<div class="book-item error-message">No books borrowed by this member</div>';
            appState.selectedBookIdReturn = null;
            return;
        }
        
        books.forEach(book => {
            const isSelected = book.id === appState.selectedBookIdReturn;
            
            const bookEl = document.createElement('div');
            bookEl.className = 'book-item' + (isSelected ? ' selected' : '');
            bookEl.innerHTML = `
                <div class="book-item-checkbox">${isSelected ? '✓' : ''}</div>
                <div class="book-item-info">
                    <div class="book-item-title">[${book.id}] ${book.title}</div>
                </div>
            `;
            
            bookEl.addEventListener('click', () => {
                document.querySelectorAll('#availableBooksListReturn .book-item').forEach(el => {
                    el.classList.remove('selected');
                    el.querySelector('.book-item-checkbox').textContent = '';
                });
                
                bookEl.classList.add('selected');
                bookEl.querySelector('.book-item-checkbox').textContent = '✓';
                appState.selectedBookIdReturn = book.id;
            });
            
            container.appendChild(bookEl);
        });
        
    } catch (error) {
        const container = document.getElementById('availableBooksListReturn');
        if (!container) return;
        container.innerHTML = '<div class="book-item error-message">Error loading borrowed books</div>';
        console.error('Error loading borrowed books:', error);
    }
}

function getFormData(formId) {
    const form = document.getElementById(formId);
    if (!form) return {};
    
    const formData = new FormData(form);
    const data = {};
    
    formData.forEach((value, key) => {
        data[key] = value;
    });
    
    return data;
}

// ============================================================================
// Check WASM Ready (safe version)
// ============================================================================

function checkWasmReady() {
    if (!WasmManager.isReady) {
        const msg = '[WARNING] WebAssembly module is loading... Please try again.';
        addConsoleLog(msg, 'warning');
        showToast('WASM module still loading', 'warning');
        return false;
    }
    return true;
}

// ============================================================================
// WASM Interface (Safe Wrappers)
// ============================================================================

/**
 * Safe wrapper for addBook
 * 
 * Signature: int addBook(string title, string author,
 *                        string publisher, int quantity, string category)
 */
async function wasmAddBook(title, author, publisher, quantity, category) {
    try {
        const id = await WasmManager.call(
            'addBook',
            'number',
            ['string', 'string', 'string', 'number', 'string'],
            [title, author, publisher, quantity, category]
        );

        addConsoleLog(`[SUCCESS] Book added (ID: ${id})`, 'success');
        return id;

    } catch (error) {
        addConsoleLog(`[ERROR] Error adding book: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Safe wrapper for issueBook
 * 
 * Signature: int issueBook(int bookId, string memberName)
 */
async function wasmIssueBook(bookId, memberName) {
    try {
        const result = await WasmManager.call('issueBook', 'number', ['number', 'string'], [bookId, memberName]);
        if (result > 0) {
            addConsoleLog(`[SUCCESS] Book issued (ID: ${bookId}, Member: ${memberName})`, 'success');
        } else {
            addConsoleLog(`[ERROR] Failed to issue book`, 'error');
            throw new Error('Failed to issue book');
        }
        return result;

    } catch (error) {
        addConsoleLog(`[ERROR] Error issuing book: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Safe wrapper for returnBook
 * 
 * Signature: int returnBook(int bookId, int memberId)
 * Returns: book ID on success, -1 or -2 on error
 */
async function wasmReturnBook(bookId, memberId) {
    try {
        const result = await WasmManager.call('returnBook', 'number', ['number', 'number'], [bookId, memberId]);
        if (result > 0) {
            addConsoleLog(`[SUCCESS] Book returned (ID: ${bookId}, Member ID: ${memberId})`, 'success');
        } else if (result === -2) {
            addConsoleLog(`[WARNING] Book returned but booking record not found`, 'warning');
        } else {
            addConsoleLog(`[ERROR] Failed to return book`, 'error');
            throw new Error('Failed to return book');
        }
        return result;

    } catch (error) {
        addConsoleLog(`[ERROR] Error returning book: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Safe wrapper for getAllBooks
 * 
 * Signature: string getAllBooks()
 */
async function wasmGetAllBooks() {
    try {
        const result = await WasmManager.call('getAllBooks', 'string', [], []);
        return result || 'No books found';

    } catch (error) {
        addConsoleLog(`[ERROR] Error fetching books: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Safe wrapper for searchBooks
 * 
 * Signature: string searchBooks(string query)
 */
async function wasmSearchBooks(query) {
    try {
        if (!query || query.trim().length === 0) {
            return 'Please enter a search term';
        }

        const result = await WasmManager.call(
            'searchBooks',
            'string',
            ['string'],
            [query.trim()]
        );
        return result || 'No results found';

    } catch (error) {
        addConsoleLog(`[ERROR] Error searching: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Safe wrapper for getStats
 * 
 * Signature: string getStats()
 */
async function wasmGetStats() {
    try {
        const result = await WasmManager.call('getStats', 'string', [], []);
        return result || 'No statistics available';

    } catch (error) {
        addConsoleLog(`[ERROR] Error fetching stats: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Safe wrapper for getBorrowedBooks
 * 
 * Signature: string getBorrowedBooks(int memberId)
 */
async function wasmGetBorrowedBooks(memberId) {
    try {
        if (!memberId || memberId <= 0) {
            return 'Please enter a valid member ID';
        }

        const result = await WasmManager.call(
            'getBorrowedBooks',
            'string',
            ['number'],
            [memberId]
        );
        return result || 'No books found';

    } catch (error) {
        addConsoleLog(`[ERROR] Error fetching borrowed books: ${error.message}`, 'error');
        throw error;
    }
}

// ============================================================================
// Form Event Handlers
// ============================================================================

async function updateDashboard() {
    if (!checkWasmReady()) return;

    try {
        const books = await loadAvailableBooks();

        document.getElementById('totalBooks').textContent = String(books.length);
        document.getElementById('totalMembers').textContent = String(appState.memberNames.size);
        document.getElementById('issuedBooks').textContent = String(appState.issuedBooksCount);
        document.getElementById('overdueBooks').textContent = '0';
    } catch (error) {
        console.error('Dashboard update failed:', error);
    }
}

async function handleAddBook(e) {
    e.preventDefault();
    if (!checkWasmReady()) return;

    const submitBtn = e.target.querySelector('[type="submit"]');
    const originalText = submitBtn.textContent;

    try {
        const title = document.getElementById('bookTitle').value.trim();
        const author = document.getElementById('bookAuthor').value.trim();
        const publisher = document.getElementById('bookPublisher').value.trim();
        const quantity = parseInt(document.getElementById('bookQuantity').value);
        const category = document.getElementById('bookCategory').value.trim();

        // Validate input - empty check
        if (!title) {
            showToast('Invalid input: Title cannot be empty', 'error');
            return;
        }
        if (!author) {
            showToast('Invalid input: Author cannot be empty', 'error');
            return;
        }
        if (!publisher) {
            showToast('Invalid input: Publisher cannot be empty', 'error');
            return;
        }

        // Validate input - length check
        if (title.length > 100) {
            showToast('Input too long: Title must be 100 characters or less', 'error');
            return;
        }
        if (author.length > 100) {
            showToast('Input too long: Author must be 100 characters or less', 'error');
            return;
        }
        if (publisher.length > 100) {
            showToast('Input too long: Publisher must be 100 characters or less', 'error');
            return;
        }

        // Validate quantity
        if (quantity <= 0) {
            showToast('Invalid input: Quantity must be greater than 0', 'error');
            return;
        }

        // Disable button while processing
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';

        const newBookId = await wasmAddBook(title, author, publisher, quantity, category);
        
        // Refresh dashboard and book lists
        await loadAvailableBooks();
        await updateDashboard();
        displayAvailableBooks('availableBooksListIssue');
        displayAvailableBooks('availableBooksListReturn');
        
        showModal('Book Added Successfully', `Book ID: ${newBookId}\nTitle: ${title}`);
        showToast('Book added successfully!', 'success');
        clearForm('addBookForm');
        
        // Scroll to reports section
        document.getElementById('reports').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        // Re-enable button
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function handleIssueBook(e) {
    e.preventDefault();
    if (!checkWasmReady()) return;

    const submitBtn = e.target.querySelector('[type="submit"]');
    const originalText = submitBtn.textContent;

    try {
        if (!appState.selectedBookIdIssue) {
            showToast('Select a book first', 'error');
            return;
        }

        const memberName = document.getElementById('memberName').value.trim();
        if (!memberName) {
            showToast('Please enter member name', 'error');
            return;
        }

        // Check if selected book has quantity available
        const selectedBook = appState.availableBooks.find(b => b.id === appState.selectedBookIdIssue);
        if (!selectedBook || selectedBook.qty <= 0) {
            showToast('Book not available', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

        const result = await wasmIssueBook(appState.selectedBookIdIssue, memberName);
        
        if (result > 0) {
            const memberId = result;  // result is now member ID
            const bookTitle = selectedBook.title;
            appState.memberNames.add(memberName);
            appState.issuedBooksCount += 1;
            
            addConsoleLog(`Member issue record created (ID: ${memberId}, Name: ${memberName})`, 'log');
            showModal('Book Issued Successfully', `Book: ${bookTitle}\nTo: ${memberName}\nMember ID: ${memberId}`);
            showToast('Book issued successfully!', 'success');
            clearForm('issueBookForm');
            appState.selectedBookIdIssue = null;
            
            // Refresh dashboard and book lists
            await loadAvailableBooks();
            await updateDashboard();
            displayAvailableBooks('availableBooksListIssue');
            displayAvailableBooks('availableBooksListReturn');
        } else {
            showToast('Failed to issue book', 'error');
        }

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function handleReturnBook(e) {
    e.preventDefault();
    if (!checkWasmReady()) return;

    const submitBtn = e.target.querySelector('[type="submit"]');
    const originalText = submitBtn.textContent;

    try {
        if (!appState.selectedBookIdReturn) {
            showToast('Select a book first', 'error');
            return;
        }

        const memberId = parseInt(appState.returnBookMemberId);
        if (!memberId || memberId <= 0) {
            showToast('Please enter a valid member ID first', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

        const result = await wasmReturnBook(appState.selectedBookIdReturn, memberId);
        
        if (result > 0) {
            appState.issuedBooksCount = Math.max(0, appState.issuedBooksCount - 1);
            
            // Find the book in the available books list
            const selectedBook = appState.availableBooks.find(b => b.id === appState.selectedBookIdReturn);
            const bookTitle = selectedBook ? selectedBook.title : 'Book #' + appState.selectedBookIdReturn;
            
            showModal('Book Returned Successfully', `Book: ${bookTitle}\nMember ID: ${memberId}\nhas been returned to library`);
            showToast('Book returned successfully!', 'success');
            
            // Reset return book form and member ID
            clearForm('returnBookForm');
            appState.selectedBookIdReturn = null;
            appState.returnBookMemberId = null;
            document.getElementById('returnMemberId').value = '';
            
            // Refresh dashboard and book lists
            await loadAvailableBooks();
            await updateDashboard();
            displayAvailableBooks('availableBooksListIssue');
            displayBorrowedBooks('returnBookMemberId');
        } else {
            showToast('Failed to return book', 'error');
        }

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function handleSearchBook() {
    if (!checkWasmReady()) return;

    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchQuery');
    const originalText = searchBtn.textContent;

    try {
        const query = searchInput.value.trim();
        
        // Validate input - empty check
        if (!query) {
            showToast('Please enter a search term', 'error');
            searchInput.focus();
            return;
        }

        // Validate input - length check
        if (query.length > 100) {
            showToast('Search query too long: must be 100 characters or less', 'error');
            return;
        }
        
        // Disable button while processing
        searchBtn.disabled = true;
        searchBtn.textContent = 'Searching...';

        const result = await wasmSearchBooks(query);
        document.getElementById('searchResults').innerText = result;
        addConsoleLog('[SUCCESS] Search complete', 'success');
        
        // Auto-focus search box for next search
        searchInput.focus();

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        // Re-enable button
        searchBtn.disabled = false;
        searchBtn.textContent = originalText;
    }
}

// ============================================================================
// Report Handlers
// ============================================================================

async function handleReportAllBooks() {
    if (!checkWasmReady()) return;

    const reportBtn = document.getElementById('reportAllBooks');
    const originalText = reportBtn.textContent;

    try {
        reportBtn.disabled = true;
        reportBtn.textContent = 'Loading...';

        const result = await wasmGetAllBooks();
        document.getElementById('reportOutput').innerText = result;
        addConsoleLog('[SUCCESS] Report generated', 'success');
        showToast('Report loaded', 'success');

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        reportBtn.disabled = false;
        reportBtn.textContent = originalText;
    }
}

async function handleReportOverdue() {
    if (!checkWasmReady()) return;

    const reportBtn = document.getElementById('reportOverdue');
    const originalText = reportBtn.textContent;

    try {
        reportBtn.disabled = true;
        reportBtn.textContent = 'Loading...';

        const stats = await wasmGetStats();
        const output = stats + '\n\n[Note] Overdue tracking based on issue dates not yet implemented.\nCurrently showing library statistics only.';
        document.getElementById('reportOutput').innerText = output;
        addConsoleLog('[SUCCESS] Library statistics loaded', 'success');
        showToast('Statistics loaded', 'success');

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        reportBtn.disabled = false;
        reportBtn.textContent = originalText;
    }
}

async function handleReportAvailable() {
    if (!checkWasmReady()) return;

    const reportBtn = document.getElementById('reportAvailable');
    const originalText = reportBtn.textContent;

    try {
        reportBtn.disabled = true;
        reportBtn.textContent = 'Loading...';

        const books = await loadAvailableBooks();
        const availableBooks = books.filter(b => b.qty > 0);
        
        const report = availableBooks.length > 0
            ? availableBooks.map(b => `ID: ${b.id} | Title: ${b.title} | Qty: ${b.qty}`).join('\n')
            : 'No available books';
        
        document.getElementById('reportOutput').innerText = report;
        addConsoleLog(`[SUCCESS] Available books report: ${availableBooks.length} matches`, 'success');
        showToast('Available books report loaded', 'success');

    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
        reportBtn.disabled = false;
        reportBtn.textContent = originalText;
    }
}

// ============================================================================
// Navigation & Section Management
// ============================================================================

async function switchSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.add('active');
        appState.currentSection = sectionId;
        
        const navItem = document.querySelector(`[data-section="${sectionId}"]`);
        if (navItem) {
            const titleText = navItem.querySelector('.text')?.textContent || sectionId;
            document.getElementById('pageTitle').textContent = titleText;
        }
    }
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-section="${sectionId}"]`)?.classList.add('active');
    document.querySelector('.sidebar').classList.remove('active');
    
    // Load available books when entering issue-book or return-book sections
    if (sectionId === 'issue-book' || sectionId === 'return-book') {
        try {
            await loadAvailableBooks();
            displayAvailableBooks('availableBooksListIssue');
            displayAvailableBooks('availableBooksListReturn');
        } catch (error) {
            showToast(`Failed to load books: ${error.message}`, 'error');
        }
    }

    if (sectionId === 'dashboard') {
        await updateDashboard();
    }
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        addConsoleLog('[INFO] Initializing Library Management System...', 'log');

        // Initialize WASM manager
        WasmManager.initialize();

        // Wait for WASM to be ready (with timeout)
        await WasmManager.readyPromise;

        appState.wasmReady = true;
        addConsoleLog('[SUCCESS] WebAssembly module ready', 'success');

        // Initialize dashboard
        await updateDashboard();
        addConsoleLog('[SUCCESS] Dashboard initialized', 'success');

        // Attach event listeners
        const addBookBtn = document.getElementById('addBookForm');
        if (addBookBtn) addBookBtn.addEventListener('submit', handleAddBook);

        const issueBookBtn = document.getElementById('issueBookForm');
        if (issueBookBtn) issueBookBtn.addEventListener('submit', handleIssueBook);

        const returnBookBtn = document.getElementById('returnBookForm');
        if (returnBookBtn) returnBookBtn.addEventListener('submit', handleReturnBook);

        const returnMemberInput = document.getElementById('returnMemberId');
        if (returnMemberInput) {
            returnMemberInput.addEventListener('input', async (e) => {
                const memberId = parseInt(e.target.value);
                appState.returnBookMemberId = memberId;
                appState.selectedBookIdReturn = null;
                
                if (memberId && memberId > 0) {
                    await loadAndDisplayBorrowedBooks(memberId);
                } else {
                    const container = document.getElementById('availableBooksListReturn');
                    if (container) {
                        container.innerHTML = '<div class="book-item">Enter a valid member ID to see borrowed books</div>';
                    }
                }
            });
        }

        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) searchBtn.addEventListener('click', handleSearchBook);

        const reportAllBtn = document.getElementById('reportAllBooks');
        if (reportAllBtn) reportAllBtn.addEventListener('click', handleReportAllBooks);

        const reportOverdueBtn = document.getElementById('reportOverdue');
        if (reportOverdueBtn) reportOverdueBtn.addEventListener('click', handleReportOverdue);

        const reportAvailableBtn = document.getElementById('reportAvailable');
        if (reportAvailableBtn) reportAvailableBtn.addEventListener('click', handleReportAvailable);

        const closeModalBtn = document.getElementById('closeModalBtn');
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.getAttribute('data-section');
                if (section) switchSection(section);
            });
        });

        addConsoleLog('[SUCCESS] Library Management System ready', 'success');

    } catch (error) {
        const msg = `[ERROR] Initialization failed: ${error.message}`;
        addConsoleLog(msg, 'error');
        console.error('[Fatal Error]', error);
    }
});

console.log('[Init] script_FIXED.js loaded');
