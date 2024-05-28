/* eslint-disable no-useless-escape */
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config()
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cors = require('cors')

import * as express from 'express'
import { NextFunction, Request, Response } from 'express'
import { HttpError } from 'http-errors'
import { getArtistInfo, getArtistProfilePictureUrl, getAvailableImageUrl, getImageInfo } from './lib/galleryHelpers'
import { checkBotAppSecretKey } from './middleware/checkTelegramSecretKey'
import { checkIsGroupAdmin } from './services/checkIsGroupAdmin'
import { galleryEditArtist, galleryEditImage, galleryGetArtist, galleryGetImage, galleryGetRandomImage, galleryUploadImage } from './services/galleryAPI'
import { getCommandText, getImageFile, getUserMention, parseEditArtistCommand, parseEditImageCommand,
  parseUploadImageCommand, sendGalleryAdmin, sendImage, sendMessage, setWebhook } from './services/telegram'
import { checkIsAllowedChat, getChatId } from './middleware/checkIsAllowedChat'
import { config } from './config'
import { getMatchingTagTitleFromTagCommandsIndex, initializeTagsCommandsIndexes, updateTagCommandsIndex } from './services/memesIndex'

const port = 9000

/*
  On startup, initialize the tagCommandsIndex for each group chat.
*/
initializeTagsCommandsIndexes()

const startApp = async () => {

  const app = express()
  app.use(express.json({
    limit: '50mb'
  }))
  app.use(express.urlencoded({
    limit: '50mb',
    extended: true
  }))

  app.use(cors())

  app.get('/', async function (req: Request, res: Response) {
    res.send('The bot is running!')
  })

  app.get('/activate', async function (req: Request, res: Response) {
    try {
      await setWebhook()
      res.send('Webhook set successfully.')
    } catch (error) {
      res.status(400)
      res.send({ message: error.message })
    }
  })

  /*
    app.get('/deactivate', async function (req: Request, res: Response) {
      try {
        await deleteWebhook()
        res.send('Webhook deleted successfully.')
      } catch (error) {
        res.status(400)
        res.send({ message: error.message })
      }
    })
  */

  app.post('/webhook',
    checkBotAppSecretKey,
    checkIsAllowedChat,
    async function (req: Request, res: Response, next: NextFunction) {
      try {
        const commandText = getCommandText(req)
        const callbackDataObject = req.body.callback_query?.data ? JSON.parse(req.body.callback_query.data) : null
        if (commandText) {
          const commands = {
            '/how_daumen_am_i': webhookHandlers.howDaumenAmI,
            '/gallery_hello': webhookHandlers.galleryHello,
            '/gallery_admin': webhookHandlers.galleryAdmin,
            '/meme': webhookHandlers.getRandomImage,
            '/random_image': webhookHandlers.getRandomImage,
            '/get_random_image_meta': webhookHandlers.getRandomImageMeta,
            '/get_image_meta': webhookHandlers.getImageMeta,
            '/get_image': webhookHandlers.getImage,
            '/upload_image': webhookHandlers.uploadImage,
            '/ui': webhookHandlers.uploadImage,
            '/edit_image': webhookHandlers.editImage,
            '/ei': webhookHandlers.editImage,
            '/edit_artist': webhookHandlers.editArtist,
            '/ea': webhookHandlers.editArtist,
            '/gallery_standards': webhookHandlers.galleryStandards
          }
          
          for (const [command, handler] of Object.entries(commands)) {
            if (new RegExp(`^${command}( |@${config.BOT_USER_NAME})?.*$`).test(commandText)) {
              await handler(req)
              break
            }
          }

          /*
            If none of those test true, then check if the command has a matching tag title in the gallery.
            If it does, return a random meme for that tag.
          */
          const groupChatId = getChatId(req)
          const tagCommandsIndexMatchingTitle = getMatchingTagTitleFromTagCommandsIndex(groupChatId, commandText)
          if (tagCommandsIndexMatchingTitle) {
            const image = await galleryGetRandomImage(tagCommandsIndexMatchingTitle)
            const imageUrl = getAvailableImageUrl('no-border', image)
            if (imageUrl) {
              await sendImage(groupChatId, imageUrl)
            } else {
              await sendMessage(groupChatId, 'Image not found')
            }
          }

        } else if (callbackDataObject?.callback_data) {
          const callbackDataHandlers = {
            'get_image_prompt': webhookHandlers.getImagePrompt,
            'upload_image_prompt': webhookHandlers.uploadImagePrompt,
            'edit_image_prompt': webhookHandlers.editImagePrompt,
            'edit_artist_prompt': webhookHandlers.editArtistPrompt            
          }
        
          const handler = callbackDataHandlers[callbackDataObject.callback_data]
          if (handler) {
            await handler(req)
          }
        }

        res.status(200)
        res.send()
      } catch (error) {
        next(error)
      }
    })

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: HttpError, req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') {
      console.error(error)
    }

    const chat_id = getChatId(req)
    const errorMessage = error?.response?.data?.message || error?.message

    if (chat_id && errorMessage) {
      sendMessage(chat_id, errorMessage)
    }
    
    // Telegram must always receive a 200 response, or it will keep retrying
    res.status(200)
    res.send()
  })

  app.listen(port)

  console.log(`App is listening on port ${port}`)
}

(async() => {
  await startApp()
})()

const webhookHandlers = {
  howDaumenAmI: async (req: Request) => {
    const chat_id = req?.body?.message?.chat?.id
    const first_name = req?.body?.message?.from?.first_name
    const username = req?.body?.message?.from?.username
    const randomPercent = Math.floor(Math.random() * 101) + '%'
    const text = `${first_name || username || ''} is ${randomPercent} daumen!`
    await sendMessage(chat_id, text)
  },
  galleryHello: async (req: Request) => {
    const chat_id = req?.body?.message?.chat?.id
    const username = req?.body?.message?.from?.username
    const userId = req?.body?.message?.from?.id
    const text = `Hello ${getUserMention(username, userId)}`
    await sendMessage(chat_id, text)
  },
  galleryAdmin: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const chat_id = req?.body?.message?.chat?.id
    await sendGalleryAdmin(chat_id)
  },
  getImagePrompt: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const chat_id = req?.body?.callback_query?.message?.chat?.id
    await sendMessage(
      chat_id, 
      'GET: type \`/get_image\` followed by the image id or slug. use \`/get_image_meta\` for full info',
      { parse_mode: 'Markdown' }
    )
  },
  uploadImagePrompt: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const chat_id = req?.body?.callback_query?.message?.chat?.id
    await sendMessage(
      chat_id, 
      'UPLOAD: reply to a file or image (file is better to prevent TG image compression), then type \`/upload_image\` with the following optional parameters:\n-t title\n-ts tags,separated,by,comma\n-a artists,separated,by,comma\n-s url-slug',
      { parse_mode: 'Markdown' }
    )
  },
  editImagePrompt: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const chat_id = req?.body?.callback_query?.message?.chat?.id
    await sendMessage(
      chat_id, 
      'EDIT: type \`/edit_image\` with the following required parameter:\n-i id-or-slug\noptional parameters:\n-t title\n-ts tags,separated,by,comma\n-a artists,separated,by,comma\n-s url-slug',
      { parse_mode: 'Markdown' }
    )
  },
  editArtistPrompt: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const chat_id = req?.body?.callback_query?.message?.chat?.id
    await sendMessage(
      chat_id, 
      'EDIT: type \`/edit_artist\` with the following required parameter:\n-i id-or-slug\noptional parameters:\n-n name\n-s url-slug\n-deca deca username\n-foundation foundation username\n-instagram instagram username\n-superrare superrare username\n-twitter twitter username\nreply to a file or image to change the profile picture',
      { parse_mode: 'Markdown' }
    )
  },
  getImage: async (req: Request) => {
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const imageId = commandText.split(' ')[1]
    const image = await galleryGetImage(imageId)
    const imageUrl = getAvailableImageUrl('no-border', image)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl)
    } else {
      await sendMessage(chat_id, 'Image not found')
    }
  },
  getImageMeta: async (req: Request) => {
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const imageId = commandText.split(' ')[1]
    const image = await galleryGetImage(imageId)
    const imageUrl = getAvailableImageUrl('no-border', image)
    const text = getImageInfo(image)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl, text)
    } else {
      await sendMessage(chat_id, text)
    }
  },
  getRandomImage: async (req: Request) => {
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const title = commandText.split(' ')[1]
    const image = await galleryGetRandomImage(title)
    const imageUrl = getAvailableImageUrl('no-border', image)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl)
    } else {
      await sendMessage(chat_id, 'Image not found')
    }
  },
  getRandomImageMeta: async (req: Request) => {
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const title = commandText.split(' ')[1]
    const image = await galleryGetRandomImage(title)
    const imageUrl = getAvailableImageUrl('no-border', image)
    const text = getImageInfo(image)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl, text)
    } else {
      await sendMessage(chat_id, text)
    }
  },
  uploadImage: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const parsedCommand = parseUploadImageCommand(commandText)
    const imageUploadData = await getImageFile(req)
  
    const { title, tagTitles, artistNames, slug } = parsedCommand
    
    const image = await galleryUploadImage({
      title,
      tagTitles,
      artistNames,
      slug,
      imageUploadData
    })

    const imageUrl = getAvailableImageUrl('no-border', image)
    const text = getImageInfo(image)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl, text)
    } else {
      await sendMessage(chat_id, text)
    }

    updateTagCommandsIndex(chat_id)
  },
  editImage: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const parsedCommand = parseEditImageCommand(commandText)
    const imageUploadData = await getImageFile(req)
  
    const { id: idOrSlug, title, tagTitles, artistNames, slug } = parsedCommand
    
    const previousImageData = await galleryGetImage(idOrSlug)

    const previousTagTitles = previousImageData.tags?.map(tag => tag.title)
    const previousArtistNames = previousImageData.artists?.map(artist => artist.name)

    const image = await galleryEditImage(previousImageData.id, {
      ...previousImageData,
      ...(title ? { title } : {}),
      ...(tagTitles?.length ? { tagTitles } : { tagTitles: previousTagTitles }),
      ...(artistNames?.length ? { artistNames } : { artistNames: previousArtistNames}),
      ...(slug ? { slug } : {}),
      imageUploadData
    })

    const imageUrl = getAvailableImageUrl('no-border', image)
    const text = getImageInfo(image)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl, text)
    } else {
      await sendMessage(chat_id, text)
    }

    updateTagCommandsIndex(chat_id)
  },
  editArtist: async (req: Request) => {
    await checkIsGroupAdmin(req)
    const commandText = getCommandText(req)
    const chat_id = req?.body?.message?.chat?.id
    const parsedCommand = parseEditArtistCommand(commandText)
    const imageUploadData = await getImageFile(req)
  
    const { id: idOrSlug, name, slug, deca_username, foundation_username,
      instagram_username, superrare_username, twitter_username
    } = parsedCommand
    
    const previousArtistData = await galleryGetArtist(idOrSlug)

    await galleryEditArtist(previousArtistData.id, {
      ...previousArtistData,
      ...(name ? { name } : {}),
      ...(slug ? { slug } : {}),
      ...(deca_username ? { deca_username } : {}),
      ...(foundation_username ? { foundation_username } : {}),
      ...(instagram_username ? { instagram_username } : {}),
      ...(superrare_username ? { superrare_username } : {}),
      ...(twitter_username ? { twitter_username } : {}),
      imageUploadData
    })

    const newArtistData = await galleryGetArtist(previousArtistData.id)

    const imageUrl = getArtistProfilePictureUrl(previousArtistData.id, 'original')
    const text = getArtistInfo(newArtistData)
    if (imageUrl) {
      await sendImage(chat_id, imageUrl, text)
    } else {
      await sendMessage(chat_id, text)
    }

    updateTagCommandsIndex(chat_id)
  },
  galleryStandards: async (req: Request) => {
    const chat_id = req?.body?.message?.chat?.id
    // eslint-disable-next-line quotes
    const text = `Try to make image titles and tags as intuitive for searching as possible.\nTry to reuse existing tag names.\nSearch the gallery to make sure the image your uploading isn't there already.\nIf an image is a profile picture, use the \"pfp\" tag.\nUse capitalization for titles like a book title (lowercase articles), unless you think it should be an exception.`
    await sendMessage(chat_id, text)
  },
}
