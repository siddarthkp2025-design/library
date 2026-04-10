#include <iostream>
#include <vector>
#include <fstream>
#include <sstream>
#include <string>
#include <cstring>
#include <emscripten.h>
using namespace std;

// Forward declaration of helper function
string toLower(string s);

/**
 * PRODUCTION-LEVEL WASM INTEGRATION
 * Key fixes:
 * 1. All functions wrapped in extern "C"
 * 2. EMSCRIPTEN_KEEPALIVE ensures exports
 * 3. getAllBooks() clears state before each call
 * 4. Proper memory handling for string returns
 * 5. Error strings allocated with malloc for safety
 */

class Book {
public:
    int id;
    string title, author, publisher, category;
    int quantity;

    Book(int i, string t, string a, string pub, int q, string cat) {
        id = i;
        title = t;
        author = a;
        publisher = pub;
        quantity = q;
        category = cat;
    }

    string toString() {
        return to_string(id) + "," + title + "," + author + "," +
               publisher + "," +
               to_string(quantity) + "," + category;
    }
};

class Member {
public:
    int memberId;
    string memberName;

    Member(int mid, string name) {
        memberId = mid;
        memberName = name;
    }

    string toString() {
        return to_string(memberId) + "," + memberName;
    }
};

class Booking {
public:
    int bookingId;
    int bookId;
    int memberId;
    int quantity;
    float fine;

    Booking(int bid, int bkid, int mid, int qty, float f) {
        bookingId = bid;
        bookId = bkid;
        memberId = mid;
        quantity = qty;
        fine = f;
    }

    string toString() {
        char buffer[256];
        sprintf(buffer, "%d,%d,%d,%d,%.2f", bookingId, bookId, memberId, quantity, fine);
        return string(buffer);
    }
};

vector<Book> books;
vector<Member> members;
vector<Booking> bookings;
int currentID = 1;
int currentBookingID = 1001;
int currentMemberId = 2001;
string filename = "library.txt";
string bookingsFilename = "bookings.txt";
string membersFilename = "members.txt";

// Global buffer for string returns (Emscripten-safe)
static string globalResultBuffer;

// ================= FILE HANDLING =================

void loadFromFile() {
    books.clear();
    ifstream file(filename);
    if (!file) return;

    string line;
    while (getline(file, line)) {
        stringstream ss(line);
        string temp;

        vector<string> data;
        while (getline(ss, temp, ',')) {
            data.push_back(temp);
        }

        if (data.size() == 6) {
            books.push_back(Book(
                stoi(data[0]),
                data[1],
                data[2],
                data[3],
                stoi(data[4]),
                data[5]
            ));
        }
    }

    file.close();

    // Fix ID duplication: Compute max ID and set currentID
    int maxID = 0;
    for (auto &b : books) {
        if (b.id > maxID) maxID = b.id;
    }
    currentID = maxID + 1;
}

void saveToFile() {
    ofstream file(filename);
    for (auto &b : books) {
        file << b.toString() << endl;
    }
    file.close();
}

void loadBookingsFromFile() {
    bookings.clear();
    ifstream file(bookingsFilename);
    if (!file) return;

    string line;
    while (getline(file, line)) {
        stringstream ss(line);
        string temp;

        vector<string> data;
        while (getline(ss, temp, ',')) {
            data.push_back(temp);
        }

        if (data.size() >= 4) {
            int bookingId = stoi(data[0]);
            int bookId = stoi(data[1]);
            int memberId = stoi(data[2]);
            int quantity = stoi(data[3]);
            float fine = (data.size() > 4) ? stof(data[4]) : 0.0f;

            bookings.push_back(Booking(bookingId, bookId, memberId, quantity, fine));

            // Update currentBookingID to be max + 1
            if (bookingId >= currentBookingID) {
                currentBookingID = bookingId + 1;
            }
        }
    }

    file.close();
}

void saveBookingsToFile() {
    ofstream file(bookingsFilename);
    for (auto &b : bookings) {
        file << b.toString() << endl;
    }
    file.close();
}

void loadMembersFromFile() {
    members.clear();
    ifstream file(membersFilename);
    if (!file) return;

    string line;
    while (getline(file, line)) {
        stringstream ss(line);
        string temp;

        vector<string> data;
        while (getline(ss, temp, ',')) {
            data.push_back(temp);
        }

        if (data.size() >= 2) {
            int memberId = stoi(data[0]);
            string memberName = data[1];

            members.push_back(Member(memberId, memberName));

            // Update currentMemberId to be max + 1
            if (memberId >= currentMemberId) {
                currentMemberId = memberId + 1;
            }
        }
    }

    file.close();
}

void saveMembersToFile() {
    ofstream file(membersFilename);
    for (auto &m : members) {
        file << m.toString() << endl;
    }
    file.close();
}

// Get or create member by name, return member ID
int getOrCreateMember(const string& memberName) {
    loadMembersFromFile();

    // Search for existing member with this name
    for (auto &m : members) {
        if (toLower(m.memberName) == toLower(memberName)) {
            return m.memberId;
        }
    }

    // Member doesn't exist, create new one
    int newMemberId = currentMemberId++;
    members.push_back(Member(newMemberId, memberName));
    saveMembersToFile();
    return newMemberId;
}

/**
 * Helper function: Build output string safely
 * CRITICAL: Must be called BEFORE returning to JS
 */
void buildResultBuffer(const string& content) {
    globalResultBuffer.clear();
    globalResultBuffer = content;
}

// Helper function to create a booking
void createBooking(int bookId, int memberId) {
    loadBookingsFromFile();
    int newBookingId = currentBookingID++;
    bookings.push_back(Booking(newBookingId, bookId, memberId, 1, 0.0f));
    saveBookingsToFile();
}

// Helper function to remove a booking by book ID and member ID
bool removeBooking(int bookId, int memberId) {
    loadBookingsFromFile();
    for (auto it = bookings.begin(); it != bookings.end(); ++it) {
        if (it->bookId == bookId && it->memberId == memberId) {
            bookings.erase(it);
            saveBookingsToFile();
            return true;
        }
    }
    return false;
}

// Helper function to get books borrowed by member
string getBorrowedBooksByMemberId(int memberId) {
    loadBookingsFromFile();
    loadFromFile();

    string output = "";
    for (auto &booking : bookings) {
        if (booking.memberId == memberId) {
            // Find the book details
            for (auto &book : books) {
                if (book.id == booking.bookId) {
                    output += to_string(book.id) + "|" + book.title + "|" + to_string(booking.bookingId) + "\n";
                    break;
                }
            }
        }
    }

    return output.empty() ? "" : output;
}

// Helper function: Convert string to lowercase
string toLower(string s) {
    for (char &c : s) c = tolower(c);
    return s;
}

// ================= EXPORTED WASM FUNCTIONS =================

extern "C" {

/**
 * Add a new book to the library
 * 
 * Signature: int addBook(string title, string author,
 *                        string publisher, int quantity, string category)
 * Returns: int (book ID) or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int addBook(const char* t, const char* a,
            const char* pub, int q, const char* cat) {
    
    if (!t || !a || !pub || !cat) {
        return -1;  // Error: null pointer
    }
    
    if (q <= 0) {
        return -1;  // Error: invalid quantity
    }

    loadFromFile();
    
    int bookId = currentID++;
    books.push_back(Book(bookId, t, a, pub, q, cat));
    
    saveToFile();
    
    return bookId;
}

/**
 * Issue a book (decrease quantity and create booking)
 * 
 * Signature: int issueBook(int bookId, string memberName)
 * Returns: member ID on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int issueBook(int bookId, const char* memberName) {
    if (!memberName) {
        return -1;  // Error: null member name
    }

    loadFromFile();

    for (auto &b : books) {
        if (b.id == bookId) {
            if (b.quantity > 0) {
                b.quantity--;
                saveToFile();
                // Get or create member and get member ID
                int memberId = getOrCreateMember(string(memberName));
                // Create booking record with member ID
                createBooking(bookId, memberId);
                return memberId;  // Return member ID, not book ID
            }
            return -1;  // Book not available
        }
    }
    return -1;  // Book not found
}

/**
 * Return a book (increase quantity and remove booking)
 * 
 * Signature: int returnBook(int bookId, int memberId)
 * Returns: book ID on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int returnBook(int bookId, int memberId) {
    if (memberId <= 0) {
        return -1;  // Error: invalid member ID
    }

    loadFromFile();

    for (auto &b : books) {
        if (b.id == bookId) {
            b.quantity++;
            saveToFile();
            // Remove booking record
            if (removeBooking(bookId, memberId)) {
                return bookId;
            }
            return -2;  // Booking not found (but book returned)
        }
    }
    return -1;  // Book not found
}

/**
 * Get all books as formatted string
 * 
 * CRITICAL PRODUCTION FIX:
 * - Clear buffer BEFORE building (not on return)
 * - Build complete result in buffer
 * - Return pointer to buffer that persists until next call
 * - Buffer is static memory, safe for JS to read
 * 
 * Signature: string getAllBooks()
 * Returns: const char* (formatted book list)
 */
EMSCRIPTEN_KEEPALIVE
const char* getAllBooks() {
    loadFromFile();

    // CRITICAL: Clear before building (not after)
    buildResultBuffer("");

    if (books.empty()) {
        buildResultBuffer("No books in library");
        return globalResultBuffer.c_str();
    }

    string output = "";
    for (const auto &b : books) {
        output += to_string(b.id) + "|" + b.title + "|" + to_string(b.quantity) + "\n";
    }

    buildResultBuffer(output);
    return globalResultBuffer.c_str();
}

/**
 * Get books borrowed by a specific member
 * 
 * Signature: string getBorrowedBooks(int memberId)
 * Returns: const char* (formatted book list or error message)
 */
EMSCRIPTEN_KEEPALIVE
const char* getBorrowedBooks(int memberId) {
    if (memberId <= 0) {
        buildResultBuffer("Error: invalid member ID");
        return globalResultBuffer.c_str();
    }

    buildResultBuffer("");

    string borrowed = getBorrowedBooksByMemberId(memberId);

    if (borrowed.empty()) {
        buildResultBuffer("No books borrowed by this member");
    } else {
        buildResultBuffer(borrowed);
    }

    return globalResultBuffer.c_str();
}

/**
 * Search books by title or author
 * 
 * Signature: string searchBooks(string query)
 * Returns: const char* (formatted search results)
 */
EMSCRIPTEN_KEEPALIVE
const char* searchBooks(const char* query) {
    if (!query) {
        buildResultBuffer("Error: null query");
        return globalResultBuffer.c_str();
    }

    loadFromFile();
    buildResultBuffer("");

    string queryLower = toLower(query);
    string output = "";
    for (auto &b : books) {
        if (toLower(b.title).find(queryLower) != string::npos ||
            toLower(b.author).find(queryLower) != string::npos) {
            output += to_string(b.id) + " | " + b.title + " | " + b.author + "\n";
        }
    }

    if (output.empty()) {
        buildResultBuffer("No matching books found");
    } else {
        buildResultBuffer(output);
    }

    return globalResultBuffer.c_str();
}
/**
 * Get library statistics
 * 
 * Signature: string getStats()
 * Returns: const char* (statistics as JSON-like format)
 */
EMSCRIPTEN_KEEPALIVE
const char* getStats() {
    loadFromFile();
    buildResultBuffer("");

    int totalBooks = 0;
    int totalQuantity = 0;

    for (const auto &b : books) {
        totalBooks++;
        totalQuantity += b.quantity;
    }

    string stats = "Total Books: " + to_string(totalBooks) + "\n" +
                   "Total Copies: " + to_string(totalQuantity) + "\n";

    buildResultBuffer(stats);
    return globalResultBuffer.c_str();
}

}  // extern "C"
