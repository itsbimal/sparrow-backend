const otpService = require("../services/otpService")
const hashService = require("../services/hashService");
const userService = require("../services/userService");
const tokenService = require("../services/tokenService");
const UserDto = require("../dtos/userDto");
const bcrypt = require("bcrypt");


class AuthController {

    async sendOtp(req, res) {
        const { phone } = req.body;
        if (!phone) {
            res.status(400).send({ message: "You must enter the phone number!" })
        }

        // gernrate otp
        const otp = await otpService.generateOtp();
        console.log(otp);

        // Time for valid hash (2MIN)
        const validity_time = 1000 * 60 * 10;

        // Time for validity expire
        const expire_time = Date.now() + validity_time;

        const data = `${phone}.${otp}.${expire_time}`;

        // Hashing
        const hash = hashService.hashOtp(data);

        try {
            await otpService.sendOtp(phone, otp);
            res.json({
                hash: `${hash}.${expire_time}`, // . is seperator
                phone,
                // otp
            });
        } catch (err) {
            console.log(err);
            res.status(500).json({ message: "Failed to send SMS" });
        }
    }

    async verifyOtp(req, res) {
        const { userOtp, hash, phone } = req.body;
        if (!userOtp || !hash || !phone) {
            res.status(400).send({ message: "You must enter the otp, hash and phone number!" });
        }


        const [hashedOtp, expire_time] = hash.split(".");
        if (Date.now() > expire_time) {
            res.status(400).send({ message: "Otp is expired!" });
        }

        const data = `${phone}.${userOtp}.${expire_time}`;
        const isValid = otpService.verifyOtp(hashedOtp, data);


        if (!isValid) { // !false === true !!false ===vfalse
            res.status(400).send({ message: "Otp is invalid!" });

        }

        let user;
        try {
            user = await userService.findUser({ phone });
            if (!user) {
                user = await userService.createUser({ phone });
            } else {
                res.status(400).send({ message: "User already exist!" });
            }

        } catch (err) {
            console.log(err);
            res.status(500).json({ message: "Database error occured" });
        }

        // Token generations
        const { accessToken, refreshToken } = tokenService.generateToken({
            _id: user._id,
        })

        // Refreshtoken Database
        await tokenService.storeRefreshToken(refreshToken, user._id);

        // Sending as cookie in browser .. refreshRToken
        res.cookie("refreshToken", refreshToken, {
            maxAge: 1000 * 60 * 60 * 24 * 7,
            httpOnly: true,
        })

        // Sending as cookie in browser .. accessToken
        res.cookie("accessToken", accessToken, {
            maxAge: 1000 * 60 * 60 * 24 * 7,
            httpOnly: true,
        })

        // Sending necessary datas as DTOS
        const userDto = new UserDto(user);
        res.status(200).json({ message: "Otp is valid", user: userDto, accessToken, refreshToken });
        // res.json({user:userDto, auth:true});

    }

    async login(req, res) {
        const { phone, password } = req.body;
        if (!phone || !password) {
            res.status(400).send({ message: "You must enter the email and password!" });
        }

        let user;
        try {
            user = await userService.findUser({ phone });
            if (!user) {
                res.status(400).send({ message: "User not found!" });
            }

            const isValid = await bcrypt.compare(password, user.password);

            if (!isValid) {
                res.status(400).send({ message: "Password is invalid!" });
            }

        } catch (err) {
            console.log(err);
            res.status(500).json({ message: "Database error occured" });
        }

        // Token generations
        const { accessToken, refreshToken } = tokenService.generateToken({
            _id: user._id,
        })

        // Refreshtoken Database
        await tokenService.storeRefreshToken(refreshToken, user._id);

        // Sending as cookie in browser .. refreshRToken
        res.cookie("refreshToken", refreshToken, {
            maxAge: 1000 * 60 * 60 * 24 * 7,
            httpOnly: true,
        })

        // Sending as cookie in browser .. accessToken
        res.cookie("accessToken", accessToken, {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 1 weeki
            httpOnly: true,
        })

        // Sending necessary datas as DTOS
        const userDto = new UserDto(user);
        res.status(200).json({ message: "Login Successful", user: userDto, accessToken, refreshToken });

    }

    // solving frequent logout
    async refresh(req, res) {
        const { refreshToken: refreshTokenFromCookie } = req.cookies;
        // console.log(req.cookies);
        // chech if it is valid
        let userData;
        try {
            userData = await tokenService.verifyRefreshToken(refreshTokenFromCookie);
            console.log("Verified")
        } catch (error) {
            console.log(error);
            return res.status(401).json({ message: "Invalid Token Error step 1" });
        }
        console.log(userData);
        console.log(refreshTokenFromCookie);
        // check if token is in dAtabase
        let token;
        try {
            token = tokenService.findRefreshToken(userData._id, refreshTokenFromCookie);
        } catch (error) {
            return res.status(401).json({ message: 'Token not found in db' });
        }

        // generate new token
        if (!token) {
            return res.status(500).json({ message: 'Token not found' });

        }
        // Chech if user is valid
        const user = await userService.findUser({ _id: userData._id });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });

        }
        //Generate new token
        const { refreshToken, accessToken } = tokenService.generateToken({ _id: userData._id })

        // Update refreshtoken in database
        try {
            await tokenService.updateRefreshToken(userData._id, refreshToken)
        } catch (error) {
            return res.status(500).json({ message: 'Update Failed' });

        }
        // put token in cookie
        res.cookie("refreshToken", refreshToken, {
            maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
            httpOnly: true,
        });

        res.cookie("accessToken", accessToken, {
            maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
            httpOnly: true,
        });

        const userDto = new UserDto(user);
        res.json({ user: userDto, auth: true }); // important

        // response
    }
    
    async logout(req,res){
        const {refreshToken} = req.cookies;
        // delete refresh token
        await tokenService.deleteToken(refreshToken);
  
        res.clearCookie('refreshToken');
        res.clearCookie('accessToken');
        res.json({user:null, auth: false});
    }


}
module.exports = new AuthController();