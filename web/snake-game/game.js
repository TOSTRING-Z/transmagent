// 贪吃蛇游戏 - JavaScript 逻辑

// 游戏常量
const GRID_SIZE = 20;
const CANVAS_SIZE = 600;
const INITIAL_SPEED = 150; // 毫秒

// 游戏状态
let snake = [];
let food = {};
let direction = 'right';
let nextDirection = 'right';
let gameInterval;
let score = 0;
let highScore = localStorage.getItem('snakeHighScore') || 0;
let level = 1;
let speed = INITIAL_SPEED;
let isPaused = false;
let isGameOver = false;
let showGrid = true;
let theme = 'classic';

// DOM 元素
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const highScoreElement = document.getElementById('high-score');
const levelElement = document.getElementById('level');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const restartBtn = document.getElementById('restart-btn');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const gridToggle = document.getElementById('grid-toggle');
const themeSelect = document.getElementById('theme-select');

// 初始化游戏
function initGame() {
    // 初始化蛇
    snake = [
        {x: 10, y: 10},
        {x: 9, y: 10},
        {x: 8, y: 10}
    ];
    
    // 生成食物
    generateFood();
    
    // 重置游戏状态
    direction = 'right';
    nextDirection = 'right';
    score = 0;
    level = 1;
    speed = INITIAL_SPEED;
    isPaused = false;
    isGameOver = false;
    
    // 更新UI
    updateScore();
    updateHighScore();
    updateLevel();
    gameOverElement.style.display = 'none';
    
    // 绘制初始游戏状态
    draw();
}

// 生成食物
function generateFood() {
    let foodPosition;
    let foodOnSnake;
    
    do {
        foodOnSnake = false;
        foodPosition = {
            x: Math.floor(Math.random() * (CANVAS_SIZE / GRID_SIZE)),
            y: Math.floor(Math.random() * (CANVAS_SIZE / GRID_SIZE))
        };
        
        // 检查食物是否在蛇身上
        for (let segment of snake) {
            if (segment.x === foodPosition.x && segment.y === foodPosition.y) {
                foodOnSnake = true;
                break;
            }
        }
    } while (foodOnSnake);
    
    food = foodPosition;
}

// 绘制游戏
function draw() {
    // 清空画布
    ctx.fillStyle = '#0a0a15';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    // 绘制网格
    if (showGrid) {
        drawGrid();
    }
    
    // 绘制蛇
    drawSnake();
    
    // 绘制食物
    drawFood();
}

// 绘制网格
function drawGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    // 垂直线
    for (let x = 0; x <= CANVAS_SIZE; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_SIZE);
        ctx.stroke();
    }
    
    // 水平线
    for (let y = 0; y <= CANVAS_SIZE; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_SIZE, y);
        ctx.stroke();
    }
}

// 绘制蛇
function drawSnake() {
    // 蛇头
    const head = snake[0];
    ctx.fillStyle = theme === 'neon' ? '#00ff88' : '#00adb5';
    ctx.fillRect(head.x * GRID_SIZE, head.y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    
    // 蛇头眼睛
    ctx.fillStyle = '#ffffff';
    const eyeSize = GRID_SIZE / 5;
    
    // 根据方向绘制眼睛
    let leftEyeX, leftEyeY, rightEyeX, rightEyeY;
    
    switch(direction) {
        case 'right':
            leftEyeX = head.x * GRID_SIZE + GRID_SIZE - eyeSize * 2;
            leftEyeY = head.y * GRID_SIZE + eyeSize * 2;
            rightEyeX = head.x * GRID_SIZE + GRID_SIZE - eyeSize * 2;
            rightEyeY = head.y * GRID_SIZE + GRID_SIZE - eyeSize * 3;
            break;
        case 'left':
            leftEyeX = head.x * GRID_SIZE + eyeSize;
            leftEyeY = head.y * GRID_SIZE + eyeSize * 2;
            rightEyeX = head.x * GRID_SIZE + eyeSize;
            rightEyeY = head.y * GRID_SIZE + GRID_SIZE - eyeSize * 3;
            break;
        case 'up':
            leftEyeX = head.x * GRID_SIZE + eyeSize * 2;
            leftEyeY = head.y * GRID_SIZE + eyeSize;
            rightEyeX = head.x * GRID_SIZE + GRID_SIZE - eyeSize * 3;
            rightEyeY = head.y * GRID_SIZE + eyeSize;
            break;
        case 'down':
            leftEyeX = head.x * GRID_SIZE + eyeSize * 2;
            leftEyeY = head.y * GRID_SIZE + GRID_SIZE - eyeSize * 2;
            rightEyeX = head.x * GRID_SIZE + GRID_SIZE - eyeSize * 3;
            rightEyeY = head.y * GRID_SIZE + GRID_SIZE - eyeSize * 2;
            break;
    }
    
    ctx.fillRect(leftEyeX, leftEyeY, eyeSize, eyeSize);
    ctx.fillRect(rightEyeX, rightEyeY, eyeSize, eyeSize);
    
    // 蛇身
    for (let i = 1; i < snake.length; i++) {
        const segment = snake[i];
        
        // 渐变颜色效果
        const colorValue = Math.max(50, 255 - i * 10);
        ctx.fillStyle = theme === 'neon' 
            ? `rgb(0, ${colorValue}, ${colorValue})` 
            : `rgb(0, ${Math.min(173, colorValue + 100)}, ${Math.min(181, colorValue + 100)})`;
        
        ctx.fillRect(segment.x * GRID_SIZE, segment.y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
        
        // 蛇身边框
        ctx.strokeStyle = theme === 'neon' ? '#00ffff' : '#008b8b';
        ctx.lineWidth = 1;
        ctx.strokeRect(segment.x * GRID_SIZE, segment.y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    }
}

// 绘制食物
function drawFood() {
    ctx.fillStyle = theme === 'neon' ? '#ff00ff' : '#ff5722';
    
    // 绘制圆形食物
    const centerX = food.x * GRID_SIZE + GRID_SIZE / 2;
    const centerY = food.y * GRID_SIZE + GRID_SIZE / 2;
    const radius = GRID_SIZE / 2 - 2;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // 食物高光效果
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(centerX - radius/3, centerY - radius/3, radius/4, 0, Math.PI * 2);
    ctx.fill();
}

// 更新游戏状态
function update() {
    // 更新方向
    direction = nextDirection;
    
    // 计算新的蛇头位置
    const head = {...snake[0]};
    
    switch(direction) {
        case 'up':
            head.y -= 1;
            break;
        case 'down':
            head.y += 1;
            break;
        case 'left':
            head.x -= 1;
            break;
        case 'right':
            head.x += 1;
            break;
    }
    
    // 检查碰撞
    if (checkCollision(head)) {
        gameOver();
        return;
    }
    
    // 添加新的蛇头
    snake.unshift(head);
    
    // 检查是否吃到食物
    if (head.x === food.x && head.y === food.y) {
        // 增加分数
        score += 10;
        updateScore();
        
        // 检查是否需要升级
        const newLevel = Math.floor(score / 100) + 1;
        if (newLevel > level) {
            level = newLevel;
            updateLevel();
            
            // 增加速度
            speed = Math.max(50, INITIAL_SPEED - (level - 1) * 20);
            updateGameSpeed();
        }
        
        // 生成新食物
        generateFood();
    } else {
        // 如果没有吃到食物，移除蛇尾
        snake.pop();
    }
    
    // 重新绘制游戏
    draw();
}

// 检查碰撞
function checkCollision(head) {
    // 检查墙壁碰撞
    if (head.x < 0 || head.x >= CANVAS_SIZE / GRID_SIZE || 
        head.y < 0 || head.y >= CANVAS_SIZE / GRID_SIZE) {
        return true;
    }
    
    // 检查自身碰撞
    for (let i = 1; i < snake.length; i++) {
        if (head.x === snake[i].x && head.y === snake[i].y) {
            return true;
        }
    }
    
    return false;
}

// 游戏结束
function gameOver() {
    isGameOver = true;
    clearInterval(gameInterval);
    
    // 更新最高分
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('snakeHighScore', highScore);
        updateHighScore();
    }
    
    // 显示游戏结束画面
    finalScoreElement.textContent = score;
    gameOverElement.style.display = 'flex';
}

// 更新分数显示
function updateScore() {
    scoreElement.textContent = score;
}

// 更新最高分显示
function updateHighScore() {
    highScoreElement.textContent = highScore;
}

// 更新等级显示
function updateLevel() {
    levelElement.textContent = level;
}

// 更新游戏速度
function updateGameSpeed() {
    if (gameInterval) {
        clearInterval(gameInterval);
        if (!isPaused && !isGameOver) {
            gameInterval = setInterval(update, speed);
        }
    }
}

// 开始游戏
function startGame() {
    if (isGameOver) {
        initGame();
    }
    
    if (!gameInterval) {
        gameInterval = setInterval(update, speed);
        isPaused = false;
        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
    }
}

// 暂停游戏
function togglePause() {
    if (isGameOver) return;
    
    if (isPaused) {
        gameInterval = setInterval(update, speed);
        isPaused = false;
        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
    } else {
        clearInterval(gameInterval);
        gameInterval = null;
        isPaused = true;
        pauseBtn.innerHTML = '<i class="fas fa-play"></i> 继续';
    }
}

// 重置游戏
function resetGame() {
    clearInterval(gameInterval);
    gameInterval = null;
    initGame();
    isPaused = false;
    pauseBtn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
}

// 键盘控制
function handleKeyDown(e) {
    switch(e.key) {
        case 'ArrowUp':
            if (direction !== 'down') nextDirection = 'up';
            break;
        case 'ArrowDown':
            if (direction !== 'up') nextDirection = 'down';
            break;
        case 'ArrowLeft':
            if (direction !== 'right') nextDirection = 'left';
            break;
        case 'ArrowRight':
            if (direction !== 'left') nextDirection = 'right';
            break;
        case ' ':
            // 空格键暂停/继续
            togglePause();
            e.preventDefault(); // 防止页面滚动
            break;
    }
}

// 事件监听器
function setupEventListeners() {
    // 键盘控制
    document.addEventListener('keydown', handleKeyDown);
    
    // 按钮控制
    startBtn.addEventListener('click', startGame);
    pauseBtn.addEventListener('click', togglePause);
    resetBtn.addEventListener('click', resetGame);
    restartBtn.addEventListener('click', resetGame);
    
    // 速度滑块
    speedSlider.addEventListener('input', function() {
        const speedLevel = parseInt(this.value);
        const speedMap = {
            1: '极慢', 2: '很慢', 3: '慢', 4: '较慢',
            5: '中速', 6: '较快', 7: '快', 8: '很快',
            9: '极快', 10: '闪电'
        };
        speedValue.textContent = speedMap[speedLevel];
        
        // 更新游戏速度
        speed = Math.max(50, INITIAL_SPEED - (speedLevel - 1) * 30);
        updateGameSpeed();
    });
    
    // 网格显示切换
    gridToggle.addEventListener('change', function() {
        showGrid = this.checked;
        draw();
    });
    
    // 主题选择
    themeSelect.addEventListener('change', function() {
        theme = this.value;
        document.body.className = `theme-${theme}`;
        draw();
    });
    
    // 触摸控制（移动设备）
    setupTouchControls();
}

// 设置触摸控制
function setupTouchControls() {
    const touchArea = canvas;
    let touchStartX = 0;
    let touchStartY = 0;
    
    touchArea.addEventListener('touchstart', function(e) {
        e.preventDefault();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });
    
    touchArea.addEventListener('touchmove', function(e) {
        e.preventDefault();
    });
    
    touchArea.addEventListener('touchend', function(e) {
        e.preventDefault();
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const dx = touchEndX - touchStartX;
        const dy = touchEndY - touchStartY;
        
        // 确定滑动方向
        if (Math.abs(dx) > Math.abs(dy)) {
            // 水平滑动
            if (dx > 0 && direction !== 'left') {
                nextDirection = 'right';
            } else if (dx < 0 && direction !== 'right') {
                nextDirection = 'left';
            }
        } else {
            // 垂直滑动
            if (dy > 0 && direction !== 'up') {
                nextDirection = 'down';
            } else if (dy < 0 && direction !== 'down') {
                nextDirection = 'up';
            }
        }
    });
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', function() {
    // 初始化游戏
    initGame();
    
    // 设置事件监听器
    setupEventListeners();
    
    // 设置初始UI状态
    updateHighScore();
    
    // 应用初始主题
    document.body.className = `theme-${theme}`;
    
    console.log('贪吃蛇游戏已加载完成！');
    console.log('控制方式：');
    console.log('- 方向键控制移动');
    console.log('- 空格键暂停/继续');
    console.log('- 触摸设备可滑动控制');
});