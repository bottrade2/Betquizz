# BetQuizz

Quiz competitivo 1v1 em tempo real com sistema de apostas virtual.

## Stack

- **Frontend:** React 18, React Router 6, Axios, Socket.io-client
- **Backend:** Node.js, Express, Socket.io, JWT, Bcrypt
- **Base de dados:** MySQL
- **Pagamentos:** Stripe (opcional)

## Pré-requisitos

- Node.js 18+
- MySQL 8+ a correr localmente (ou MySQL na cloud)

## Setup em 4 passos

### 1. Variáveis de ambiente

Edita `.env` na raiz:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=a_tua_password
DB_NAME=betquizz
JWT_SECRET=uma_chave_secreta_longa_e_aleatoria
CLIENT_URL=http://localhost:3000
```

Edita também `frontend/.env`:

```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_SOCKET_URL=http://localhost:5000
```

### 2. Instalar dependências

```bash
npm run install:all
```

### 3. Arrancar o backend

```bash
cd backend
npm run dev
```

O servidor inicia em `http://localhost:5000`.  
As tabelas MySQL são criadas automaticamente no primeiro arranque.

### 4. Arrancar o frontend

```bash
cd frontend
npm start
```

O app abre em `http://localhost:3000`.

---

## Estrutura do projecto

```
betquizz/
├── .env                          # Variáveis de ambiente
├── backend/
│   ├── server.js                 # Express + Socket.io
│   ├── socket.js                 # Lógica de jogo em tempo real
│   ├── database.js               # Pool MySQL + init tabelas
│   ├── routes/
│   │   ├── auth.js               # Registo, login, perfil
│   │   ├── game.js               # Salas, leaderboard, histórico
│   │   ├── payment.js            # Stripe (pagamento de moedas)
│   │   └── admin.js              # Painel de administração
│   ├── middleware/
│   │   └── auth.js               # JWT guard
│   ├── data/
│   │   └── questions.js          # 216 perguntas (6 temas × 3 níveis)
│   ├── bot/
│   │   ├── botEngine.js          # IA dos bots (accuracy, delay)
│   │   └── botManager.js        # Ciclo de vida dos bots
│   └── migrations/
│       ├── payment_tables.js     # Tabela de pagamentos
│       └── add_bot_columns.js    # Colunas vs_bot
└── frontend/
    ├── public/index.html
    └── src/
        ├── App.js
        ├── index.js
        ├── styles.css
        ├── components/
        │   ├── Login.js
        │   ├── Register.js
        │   ├── GameRoom.js
        │   ├── Quiz.js
        │   └── Leaderboard.js
        ├── pages/
        │   ├── Home.js
        │   └── Profile.js
        └── utils/
            ├── api.js            # Axios com JWT
            └── socket.js         # Socket.io client
```

## Funcionalidades

- Registo/login com JWT
- Criar salas com tema, dificuldade e aposta
- Jogar vs outro jogador (em tempo real via Socket.io)
- Jogar vs Bot (3 dificuldades: Fácil, Médio, Difícil)
- Sistema de scoring baseado em velocidade (10–100 pts por pergunta)
- Timer de 15 segundos por pergunta
- Chat em tempo real na sala (jogos vs humano)
- Ranking global
- Histórico de partidas
- 216 perguntas em 6 temas × 3 dificuldades
- Pagamentos Stripe para comprar moedas (configuração opcional)

## Produção

Para deploy, define `CLIENT_URL` com o domínio real e usa `npm start` no backend.  
No frontend, cria um build com `npm run build` e serve a pasta `build/` com Nginx ou similar.
