/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
"use strict"
const express = require('express');
const router = new express.Router();
const { body_parser_error_handler, get_user, invalidate_cached_user } = require('../helpers');
const config = require('../config');
const { DB_WRITE } = require('../services/database/consts');

// -----------------------------------------------------------------------//
// POST /send-pass-recovery-email
// -----------------------------------------------------------------------//
router.post('/send-pass-recovery-email', express.json(), body_parser_error_handler, async (req, res, next)=>{
    // either api. subdomain or no subdomain
    if(require('../helpers').subdomain(req) !== 'api' && require('../helpers').subdomain(req) !== '')
        next();

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const validator = require('validator')

    // validation
    if(!req.body.username && !req.body.email)
        return res.status(400).send('Username or email is required.');
    // username, if provided, must be a string
    else if (req.body.username && typeof req.body.username !== 'string')
        return res.status(400).send('username must be a string.')
    // if username doesn't pass regex test it's invalid anyway, no need to do DB lookup
    else if(req.body.username && !req.body.username.match(config.username_regex))
        return res.status(400).send('Invalid username.')
    // email, if provided, must be a string
    else if (req.body.email && typeof req.body.email !== 'string')
        return res.status(400).send('email must be a string.')
    // if email is invalid, no need to do DB lookup anyway
    else if(req.body.email && !validator.isEmail(req.body.email))
        return res.status(400).send('Invalid email.')

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('send-pass-recovery-email') ) {
        return res.status(429).send('Too many requests.');
    }


    try{
        let user;
        // see if username exists
        if(req.body.username){
            user = await get_user({username: req.body.username});
            if(!user)
                return res.status(400).send('Username not found.')
        }
        // see if email exists
        else if(req.body.email){
            user = await get_user({email: req.body.email});
            if(!user)
                return res.status(400).send('Email not found.')
        }

        // check if user is suspended
        if(user.suspended){
            return res.status(401).send('Account suspended');
        }
        // set pass_recovery_token
        const { v4: uuidv4 } = require('uuid');
        const nodemailer = require("nodemailer");
        const token = uuidv4();
        await db.write(
            'UPDATE user SET pass_recovery_token=? WHERE `id` = ?',
            [token, user.id]
        );
        invalidate_cached_user(user);

        // prepare email
        let transporter = nodemailer.createTransport({
            host: config.smtp_server,
            port: config.smpt_port,
            secure: true, // STARTTLS
            auth: {
                user: config.smtp_username,
                pass: config.smtp_password,
            },
        });

        // create link
        const rec_link = config.origin + '/action/set-new-password?user=' + user.uuid + '&token=' + token;

        // send email
        transporter.sendMail({
            from: 'no-reply@puter.com', // sender address
            to: user.email, // list of receivers
            subject: "Password Recovery", // Subject line
            html: `
            <p>Hi there,</p>
            <p>A password recovery request was issued for your account, please follow the link below to reset your password:</p>
            <p><a href="${rec_link}">${rec_link}</a></p>
            <p>Sincerely,</p>
            <p>Puter</p>`,
        });

        // Send response
	return res.send({message: `If the email address exists in our database. A recovery email will be sent to <strong>${user.email}</strong>`});

    }catch(e){
        console.log(e)
        return res.status(400).send(e);
    }

})

module.exports = router
