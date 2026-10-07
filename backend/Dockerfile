FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y ffmpeg python3 python3-pip curl unzip \
    RUN python3 -m pip install -U --pre "yt-dlp[default]"
    && curl -fsSL https://deno.land/install.sh | sh \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p temp

EXPOSE 10000

CMD ["node", "server.js"]
