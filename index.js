const express = require('express');
const cors = require('cors');
const db = require('./db');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const salt = 10;
const app = express();

app.use(express.json());
app.use(cookieParser());

// CORS configuration
app.use(cors({
    origin: 'https://coursesuggestion-production.up.railway.app', // Your frontend's URL
    credentials: true, 
}));
const sessionStore = new MySQLStore({}, db);
// Session configuration .
app.use(
    session({
        key: 'user_sid',
        secret: 'your-secret-key',
        resave: false,
        store: sessionStore,
        saveUninitialized: false,
        cookie: {
            path: '/',
            httpOnly: true,
            secure:false,
            sameSite:'lax',
        },
    })
);

const uploadPath = path.join(__dirname, 'uploads');
// Ensure the 'uploads' directory exists
if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage });

// Serve uploaded files statically
app.use('/uploads', express.static(uploadPath));


// Middleware for authentication
function authMiddleware(req, res, next) {
    if (req.session && req.session.user) {
        next(); // Proceed to next middleware or route handler
    } else {
        res.status(401).json({ message: "Unauthorized. Please log in." });
    }
}
app.use((req, res, next) => {
  console.log(`Received ${req.method} request at ${req.url}`);
  next();
});
app.post('/', (req, res) => {
  try {
    console.log("POST body:", req.body);
    res.send('POST request received');
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get('/', (req, res) => {
  res.send('Using Get Request');
});


// Sidebar route with authentication
app.post('/component/sidebar', authMiddleware, (req, res) => {
    const auth =  req.session.user;
    if(!auth){
        return res.status(401).send('Not looged in');
    }
    return res.status(200).send('Authorized');
});


// Login routes
app.post('/login', (req, res) => {
        const { email, password } = req.body;
    
    // Check for admin login
    if (email === 'admin@gmail.com' && password === 'qwerty') {
        req.session.user = {
            id: 0,
            username: 'admin',
        };
        req.session.save((err) => {
            if (err) {
                return res.status(500).json({ message: 'Session save error (admin)', error: err.message });
            }
            return res.status(200).json({ message: 'Welcome Admin' });
        });
        return; // Prevents double response
    }

    // Regular user login
    const query2 = "SELECT * FROM account WHERE email = ?";
    db.query(query2, [email], (err, row) => {
        if (err) {
            return res.status(500).json({ message: "Database error", error: err.message });
        }

        if (row.length !== 1) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const user = row[0];

        bcrypt.compare(password, user.password, (err, matched) => {
            if (err) {
                return res.status(500).json({ message: "Bcrypt comparison error", error: err.message });
            }

            if (!matched) {
                return res.status(401).json({ message: "Invalid email or password" });
            }

            req.session.user = {
                id: user.id,
                username: user.username,
            };

            req.session.save((err) => {
                if (err) {
                    return res.status(500).json({ message: 'Session save error (user)', error: err.message });
                }
                return res.status(200).json({ message: "Welcome User" });
            });
        });
    });
});


// Register route
app.post('/register', (req, res) => {
    const { username, email, password } = req.body;

    // Hash the password
    bcrypt.hash(password, salt, (err, hash) => {
        if (err) {
            return res.status(500).json({ message: "Bcrypt hash failed", error: err.message });
        }

        // Check if the email already exists
        const query2 = "SELECT * FROM account WHERE email = ?";
        db.query(query2, [email], (err, row) => {
            if (err) {
                return res.status(500).json({ message: "Database error", error: err.message });
            }

            if (row.length > 0) {
                return res.status(400).json({ message: "Email already exists" });
            } else {
                const query = "INSERT INTO account (username, email, password) VALUES (?, ?, ?)";
                db.query(query, [username, email, hash], (err) => {
                    if (err) {
                        return res.status(500).json({ message: "Error inserting user", error: err.message });
                    }
                    return res.status(200).json({ message: "User registered successfully" });
                });
            }
        });
    });
});

// Dashboard route with user results (authentication required)
app.post('/component/Dashboard', authMiddleware, (req, res) => {
    const resultinfo = req.session.user;
  
    if (!resultinfo) {
      return res.status(401).send('User not logged in');
    }
    const { 
      name, subject, level, percent, start_time, end_time, 
      goodAt, improvement, courseSuggestions, submittedData 
    } = req.body;
  
    const userId = resultinfo.id;
  
    // Insert into result_table
    const insertResultQuery = `
      INSERT INTO result_table(mid, name, subject, level, percent, start, end, good, improvement, courseSuggestions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
  
    db.query(insertResultQuery, [
      userId, name, subject, level, percent, start_time, end_time,
      JSON.stringify(goodAt),
      JSON.stringify(improvement),
      JSON.stringify(courseSuggestions)
    ], (error, result) => {
      if (error) {
        return res.status(500).send('Database error in result_table');
      }
  
      const resultId = result.insertId; // 🛑 Correct way to get new id
  
      // Now insert all questions one by one
      submittedData.forEach((q) => {
        const insertQuestionQuery = `
          INSERT INTO question (mid, question, option1, option2, option3, option4, correctoption, selectedoption)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
  
        db.query(insertQuestionQuery, [
          resultId,
          q.question,
          q.options[0],
          q.options[1],
          q.options[2],
          q.options[3],
          q.correctAnswer,
          q.selectedOption
        ], (err) => {
          if (err) {
            console.error(err);
          }
        });
      });
  
      return res.status(200).send('Result uploaded successfully');
    });
  });
  
// Suggestion course navigation Routes
app.post('/component/suggestion', authMiddleware, (req,res)=>{
    const suggest= req.session.user;
    if(!suggest){
        return res.status(401).send('User Not Logged In');
    }
    const suggestId = suggest.id; 
    const fetch_query="SELECT courseSuggestions FROM result_table WHERE mid = ?";
    db.query(fetch_query, [suggestId], (error, result)=>{
        if(error){
            return res.status(500).send('Database Couldnot Connect');
        }
        if(result.length === 0){
            return res.status(404).send('No data Found');
        }
        const showSuggest = result.map(row => {
    try {
      return JSON.parse(row.courseSuggestions);
    } catch (err) {
      console.error("JSON parse error:", err.message);
      return null;
    }}).filter(s => s !== null);

        return res.status(200).json({ showSuggest });

    })
})

//Billing & Payment records Database
app.post('/component/billing', authMiddleware, (req,res)=>{
    const billing = req.session.user;
    if(!billing){
        return res.status(401).send('User Not Logged in');
    }
    const userId = billing.id;
    const billing_query = "SELECT * FROM payment_data WHERE mid = ?";
    db.query(billing_query, [userId], (error, result)=>{
        if(error){
            return res.status(500).send('DataBase Error');
        }
        if(result.length == 0){
            return res.status(404).send('No Data Found');
        }
        return res.status(200).json(result);
        
        
    })
})



// Progress route (fetch user progress)
app.post('/component/Progress', authMiddleware, (req, res) => {
    const progress = req.session.user;

    if (!progress) {
        return res.status(401).send('User not logged in');
    }
    const userId = progress.id;

    // Step 1: Fetch the user's progress data (all columns from result_table) based on the `mid`
    const progressQuery = "SELECT * FROM result_table WHERE mid = ?";
    
    db.query(progressQuery, userId, (error, result) => {
        if (error) {
            return res.status(500).send('Database error');
        }

        // Check if result exists for the given mid
        if (result.length === 0) {
            return res.status(404).send('No data found for this user.');
        }

        // Step 2: Get the id from the result table (assuming result is an array of results)
        const resultId = result[0].id;

        // Step 3: Fetch questions related to the resultId from the question table
        const questionQuery = "SELECT * FROM question WHERE mid = ?";  // Assuming `result_id` is the foreign key in `question` table
        db.query(questionQuery, resultId, (error, questions) => {
            if (error) {
                return res.status(500).send('Database error while fetching questions');
            }

            // Step 5: Combine progress data with questions data and send response
            return res.status(200).json({
                message: "Fetched data successfully",
                data: { progress: result, questions: questions }
            });
        });
    });
});

//List of Purchased Courses
app.post('/component/Purchased', authMiddleware, (req,res)=>{
    const Purchased = req.session.user;
    if(!Purchased){
        return res.status(401).send('User Not Logged In');
    }
    const userId = Purchased.id;
    const query = "SELECT subject FROM payment_data WHERE mid = ? AND status = ? ";
    db.query(query, [userId, "approved"],(error, result)=>{
        if(error){
            return res.status(500).send("Database Error");
        }
        if(result.length == 0){
            return res.status(404).send("No Data Found");
        }
        return res.status(200).json(result);
    })

})




//Status Updating 
app.post('/AdminComponent/UpdatePaymentStatus', authMiddleware, (req, res) => {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).send('Missing fields');
    db.query("UPDATE payment_data SET status = ? WHERE id = ?", [status, id], (err) => {
      if (err) return res.status(500).send('Database error');
      res.status(200).send('Status updated');
    });
  });

  // Admin Component for CoursManagment
app.post('/AdminComponent/CourseManagment', authMiddleware , (req,res)=>{
    const method = req.session.user;
    if(!method){
        return res.status(401).send('User not Logged');
    }
    const query = "SELECT courseSuggestions FROM result_table";
    db.query(query, (error, result)=>{
        if(error){
            console.log(error);
            return res.status(500).send('Database Error');
        }
        if(result.length === 0){
            return res.status(404).send('No Record Found');
        }
        return res.status(200).json(result);
    })
})
// Admin Billing & Payments
app.post('/AdminComponent/BillingPayment', authMiddleware, (req, res) => {
    const method = req.session.user;
    if(!method){
        return res.status(401).send('User not Logged');
    }
    const query = "SELECT id, name, subject, method, status, image FROM payment_data";
    db.query(query, (err, result) => {
      if (err) return res.status(500).send('Database Error');
      if (result.length === 0) return res.status(404).send('No Data Found');
      res.status(200).json(result);
    });
  });

//User Count
app.post('/AdminComponent/totalUsers', authMiddleware,(req,res)=>{
    const total = req.session.user;
    if(!total){
        return res.status(401).send('user Not Logged');
    }
    const query = "SELECT email FROM account";
    db.query(query, (error, result)=>{
        if(error){
            return res.status(500).send('Database error');
        }
        res.status(200).send(result.length);
    })
})
app.post('/AdminComponent/totalamount', authMiddleware,(req,res)=>{
    const total = req.session.user;
    if(!total){
        return res.status(401).send('user Not Logged');
    }
    const query = "SELECT courseSuggestions FROM result_table";
    db.query(query, (error, result)=>{
        if(error){
            return res.status(500).send('Database error');
        }
        res.status(200).send(result.length * 500);
    })
})
app.post('/AdminComponent/totalcourses', authMiddleware,(req,res)=>{
    const total = req.session.user;
    if(!total){
        return res.status(401).send('user Not Logged');
    }
    const query = "SELECT courseSuggestions FROM result_table";
    db.query(query, (error, result)=>{
        if(error){
            return res.status(500).send('Database error');
        }
        res.status(200).send(result.length);
    })
})





// Update user settings
app.post('/component/setting', authMiddleware, (req, res) => {
    const { name, phoneNumber, country, province, city, street } = req.body;
    const updateUser = req.session.user;

    if (!updateUser) {
        return res.status(401).send('User not logged in');
    }

    const user = {
        id: updateUser.id,
        username: updateUser.username,
    };

    const userQuery = "INSERT INTO user_data (id, username, number, country, prov, city, street) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username), number = VALUES(number), country = VALUES(country), prov = VALUES(prov), city = VALUES(city), street = VALUES(street);";
    db.query(userQuery, [user.id, name, phoneNumber, country, province, city, street], (err) => {
        if (err) {
            return res.status(500).json({ message: "Error updating user data", error: err.message });
        }

        const data_query = "SELECT * FROM user_data WHERE id = ?";
        db.query(data_query, [user.id], (error, result) => {
            if (error) {
                return res.status(500).json({ message: "Error fetching updated data", error: error.message });
            }

            if (result.length === 0) {
                return res.status(404).send("No data found");
            }
            res.status(200).json(result); // ✅ Send updated user data back to the frontend
        });
    });
});



// Update user settings
app.post('/component/Updating_user', authMiddleware, (req, res) => {
    const updateUser = req.session.user;
  
    if (!updateUser) {
      return res.status(401).send('User not logged in');
    }
  
    const userId = updateUser.id;
  
    // First, get user_data
    const userDataQuery = "SELECT * FROM user_data WHERE id = ?";
    db.query(userDataQuery, [userId], (err, userDataResult) => {
      if (err) {
        return res.status(500).json({ message: "Error fetching user data", error: err.message });
      }
  
      if (userDataResult.length === 0) {
        return res.status(404).send("No user data found");
      }
  
      // Then, get email from users table
      const userEmailQuery = "SELECT email FROM account WHERE id = ?";
      db.query(userEmailQuery, [userId], (err2, emailResult) => {
        if (err2) {
          return res.status(500).json({ message: "Error fetching email", error: err2.message });
        }
  
        const combinedData = {
          ...userDataResult[0],
          email: emailResult[0]?.email || '' // fallback if no email
        };
  
        return res.status(200).json(combinedData);
      });
    });
  });
  






// Route for receiving payment form
app.post('/component/submitPayment', upload.single('receipt'), (req, res) => {
    const Payment = req.session.user;
    if (!Payment) {
      return res.status(401).send("User Not Logged in");
    }
  
    const userId = Payment.id;
    const { name, subject, paymentMethod } = req.body;
    const filePath = req.file ? `uploads\\${req.file.filename}` : null;
  
    if (!name || !subject || !paymentMethod || !filePath) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
  
    const sql = 'INSERT INTO payment_data(mid, name, subject,method, image) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [userId ,name, subject, paymentMethod, filePath], (err, result) => {
      if (err) {
        console.error('Error inserting payment:', err);
        return res.status(500).json({ message: 'Database insert failed' });
      }
      res.status(200).json({ message: 'Payment submitted successfully' });
    });
  });
  
// Admin Component for User managment 
app.post('/AdminComponent/UserManagment', authMiddleware, (req, res) => {
    const manage = req.session.user;
    
    if (!manage) {
        return res.status(401).send('User Not Logged in');  
    }

    const query = "SELECT * FROM account";
    db.query(query, (error, result) => {
        if (error) {
            console.error("Database Error:", error); 
            return res.status(500).send('Database Error'); 
        }

        if (result.length === 0) {
            return res.status(404).send('No Records Found');
        }
        return res.status(200).json(result);
    });
});


// Password Changing
app.post('/api/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const updateUser = req.session.user;

    // Ensure user is logged in
    if (!updateUser) {
        return res.status(401).send('User not logged in');
    }

    const user = {
        id: updateUser.id,
    };

    try {
        // Find the user by ID from the database using async/await
        const [rows] = await db.promise().query('SELECT * FROM account WHERE id = ?', [user.id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const dbUser = rows[0]; // Store the user from DB

        // Compare the current password with the hashed password in DB
        const isMatch = await bcrypt.compare(currentPassword, dbUser.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update the user's password in the database
        await db.promise().query('UPDATE account SET password = ? WHERE id = ?', [hashedPassword, dbUser.id]);

        // Return success response
        res.status(200).json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});


// Get session data
app.post("/get-session", (req, res) => {
    if (req.session.user) {
        return res.status(200).json(req.session.user);
    } else {
        return res.status(404).json({ message: "No session found" });
    }
});

// Logout route
app.post("/component/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: "Error logging out" });
        }
        res.clearCookie("user_sid", {
            path: '/',          // IMPORTANT: this must match your session cookie settings
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
        });
        return res.status(200).json({ message: "Logged out successfully" });
    });
});


// Start the server
app.listen(8080, () => {
  console.log(`Server is running on 8080`);
});
