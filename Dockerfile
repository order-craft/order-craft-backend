FROM node:22-alpine

#app directory
WORKDIR /app

#copy package.json

COPY package*.json ./

#install app dependencies

RUN npm install

# copy the rest of the app to our image

COPY . .

#set envirement variables

#ENV MONGO=mongodb+srv://saadliwissem88:12715083w@cafein.ctsilpo.mongodb.net/?retryWrites=true&w=majority&appName=CafeIn
ENV PORT=3123
ENV CLOUDINARY_NAME=dq4bfwxbx
ENV CLOUDINARY_API_KEY=491994756846823
ENV CLOUDINARY_API_SECRET=3gC_-jH0SgpYP2Mq08SIpTrsKJY
ENV JWT_SECRET_KEY=RyyTwyqhIytpayn9cYA1KpXbD2GV1h2q
ENV MAIL_SENDER_PASS="qzwg eooi vbsa muyv"
ENV MAIL_SENDER_EMAIL=saadliwissem88@gmail.com
ENV SECURE_TRANSACTION_TOKEN="order-craft6Lc?FUVF?4lNThcPWGZD1ZPXrocNsQ3r5-NTH1D7z6/fWmA3-/gFWMkqswVXoae8tYFKO0ZrS2UVz!1Ue!AapqsnSdFq/XL8E?505J511H5j8l?P3tnGoP9a5!YEk=upCD9NPhG4dBr2NeTFFLlz!1xqiJ8v3kOK34hSkT0dvVOo1wBROQwGaxfqoAphzeg6lK1vAclg/vR2csXF6fxZZjh?qcvVHD1HFRy1IqHzLErkwILm5?!Ro"

EXPOSE 3123
#run the app 

CMD ["node", "index.js"]

