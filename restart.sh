#!/bin/bash
pkill -f "node.*server.js"
sleep 2
npm start
