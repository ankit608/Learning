import { Request, Response, NextFunction } from "express"
require('dotenv').config();
import userModel, { IUser } from "../models/user.model"
import ErrorHandler from "../utils/ErrorHandler"
import { catchAsyncError } from "../middleware/catchAsyncError"
import jwt, { JwtPayload, Secret } from "jsonwebtoken"
import ejs from "ejs"
import path from "path"
import sendMail from "../utils/sendmail";
import { sendToken } from "../utils/jwt";
import { redis } from "../utils/redis";


//register user


interface IRegistrationBody {

    name: string
    email: string
    password: string
    avatar?: string
}

interface ILoginRequest{
    email:string,
    password: string,
}

export const loginUser = catchAsyncError(async(req:Request,res:Response,next:NextFunction)=>{
    try{
        const{email,password} = req.body as ILoginRequest
        if(!email && !password){
            return next(new ErrorHandler("Enter correct Email and password",400));
        }
          
        const user = await userModel.findOne({email}).select("+password")
   if(!user){

      return next(new ErrorHandler("User doses not exist please signIn",400))
   }
     
      const isMatched =   await user.comparePassword(password);

      if(!isMatched){
             return next(new ErrorHandler("Wrong password",400))
      }
      
    
    sendToken(user,200,res);
    }catch(error:any){
         return next(new ErrorHandler(error.message,400));
    }
    

})

export const LogoutUser = catchAsyncError(async(req:Response,res:Response,next:NextFunction)=>{
    try{
        res.cookie("access_token","",{maxAge:1})
        res.cookie("refresh_token","",{maxAge:1});
         
        const userId = req.user?._id || '';
         console.log(userId);
        redis.del(userId)

        res.status(200).json({
            success:true,
            message:"Logged out successfully"
        })

    }catch(error:any){
      
        return next(new ErrorHandler(error.message,400))
    }
})


export const registrationUse = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {

        const { name, email, password } = req.body;
        console.log(name, email, password)
        console.log("hello");
        const isEmailExist = await userModel.findOne({ email })
        if (isEmailExist) {
            return next(new ErrorHandler("Email already exist", 400))
        }

        const user: IRegistrationBody = {
            name,
            email,
            password
        };

        const activationToken = createActivationToken(user)
        const activationCode = activationToken.activationCode;
        const data = { user: { name: user.name }, activationCode };

        const html = await ejs.renderFile(path.join(__dirname, "../mails/activation-mail.ejs"), data)



        try {

            await sendMail({
                email: user.email,
                subject: "Activate your account",
                template: "activation-mail.ejs",
                data,
            })
            res.status(201).json({
                success: true,
                message: `Please check your email:${user.email} to activate your account`,
                activationToken: activationToken.token
            })

        } catch (error: any) {
            return next(new ErrorHandler(error.message, 400))
        }

    } catch (error: any) {
        return next(new ErrorHandler(error.message, 400))
    }
})


interface IActivationToken {
    token: string
    activationCode: string;
}

export const createActivationToken = (user: any): IActivationToken => {
    const activationCode = Math.floor(1000 + Math.random() * 9000).toString();
    const token = jwt.sign({ user, activationCode }, process.env.ACTIVATION_SECRET as Secret, { expiresIn: "5m" })
    return { token, activationCode }
}


export const activateUser = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token, activationCode } = req.body as IActivationToken
        const newUser: { user: IUser; activationCode: string } = jwt.verify(token, process.env.ACTIVATION_SECRET as string) as { user: IUser; activationCode: string }

        if (newUser.activationCode != activationCode) {
            return next(new ErrorHandler("Invalid Activation Code", 400))
        }

        const { name, email, password } = newUser.user;

        const existUser = await userModel.findOne({ email });

        if (existUser) {
            return next(new ErrorHandler("Email alredy exist", 400))
        }

        const user = await userModel.create({
            name,
            email,
            password,
        })

        res.status(201).json({
            success: true
        })

    } catch (error: any) {

        return next(new ErrorHandler(error.message, 400))
    }
})


//update acccess token//

interface ITokenOptions {

    expire:Date;
    maxAge:number
    httpOnly: boolean
    sameSite: 'lax'| 'strict' | undefined;
    secure?:boolean

}

export const updateAccessToken = catchAsyncError(async(req:Request,res:Response,next:NextFunction)=>{

    try{
       
        const refresh_token = req.cookies.refresh_token as string;
        const decoded = jwt.verify(refresh_token,process.env.REFRESH_TOKEN as string) as JwtPayload

        const message = "Could not refresh Token"
        if(!decoded){
            return next(new ErrorHandler(message,400))
        }
     
        const session = await redis.get(decoded.id as string)

        if(!session){
            return next(new ErrorHandler(message,400))
        }
        
        const user  = JSON.parse(session)
        const access_token = jwt.sign({id:user._id},process.env.ACCESS_TOKEN as string,{
            expiresIn:"5m"
        })
        const accessTokenExpire = parseInt(process.env.ACCESS_TOKEN_EXPIRE|| '300',10)
        const refreshTokenExpire = parseInt(process.env.REFRESH_TOKEN_EXPIRE|| '1200',10)
        const accessTokenOptions: ITokenOptions={
            expire: new Date(Date.now()+accessTokenExpire*60*60*1000),
            maxAge: accessTokenExpire*60*60*1000,
            httpOnly:true,
            sameSite: 'lax',
            secure:false
         
     }
     const refreshtokenOptions: ITokenOptions={
         expire: new Date(Date.now()+refreshTokenExpire*60*60*1000),
         maxAge: accessTokenExpire*24*60*60*1000,
         httpOnly:true,
         sameSite: 'lax',
         secure:false
  }
        

  res.cookie("access_token",access_token,accessTokenOptions)
  res.cookie("refresh_token",refresh_token,refreshtokenOptions)
  res.status(200).json({
    status:"success",
    access_token

  })
    }catch(error:any){

        return next(new ErrorHandler(error.message,400))
    }

})