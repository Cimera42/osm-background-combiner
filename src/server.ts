import Logger from './lib/log';
import express, {NextFunction, Request, Response} from 'express';
import axios from 'axios';
import sharp from 'sharp';
import settings from '../settings.json';
import {BaseError} from './lib/error';

const logger = new Logger('Server');

const logRequest = (req: Request, res: Response, next: NextFunction) => {
    logger.info(req.originalUrl);
    next();
};

class StravaError extends BaseError {}

async function getStrava(sw: string, x: string, y: string, zoom: string): Promise<Buffer> {
    const {policy, signature, keyPair} = settings.stravaCookies;

    try {
        const strava = await axios({
            method: 'get',
            url: `https://heatmap-external-${sw}.strava.com/tiles-auth/all/hot/${zoom}/${x}/${y}.png?Key-Pair-Id=${keyPair}&Policy=${policy}&Signature=${signature}`,
            responseType: 'arraybuffer',
        });
        return strava.data;
    } catch (e) {
        logger.error(
            `Strava: (${zoom}, ${x}, ${y}) - ${e?.response?.status}: ${e?.response?.statusText}`
        );
        throw new StravaError(e);
    }
}

async function getDCS(x: string, y: string, zoom: string): Promise<Buffer> {
    try {
        const dcsNSW = await axios({
            method: 'get',
            url: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/${zoom}/${y}/${x}`,
            responseType: 'arraybuffer',
        });
        return dcsNSW.data;
    } catch (e) {
        logger.error(
            `DCS: (${zoom}, ${x}, ${y}) - ${e?.response?.status}: ${e?.response?.statusText}`
        );
        return sharp({
            create: {
                width: 256,
                height: 256,
                channels: 4,
                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0,
                },
            },
        })
            .png()
            .toBuffer();
    }
}

export async function runServer(): Promise<void> {
    const port = process.env.PORT || 3000;

    const app = express();
    app.use(logRequest);

    app.get('/:sw/:zoom/:x/:y', async (req, res) => {
        try {
            const {sw, x, y, zoom} = req.params;
            const [strava, dcsNSW] = await Promise.all([
                getStrava(sw, x, y, zoom),
                getDCS(x, y, zoom),
            ]);

            const dcsImage = sharp(dcsNSW);
            const stravaImage = sharp(strava);
            const stravaImageMeta = await stravaImage.metadata();
            const dcsImageMeta = await dcsImage.metadata();

            const width = Math.max(dcsImageMeta.width ?? 0, stravaImageMeta.width ?? 0);
            const height = Math.max(dcsImageMeta.height ?? 0, stravaImageMeta.height ?? 0);

            const combined = await dcsImage
                .resize(width, height)
                .composite([{input: await stravaImage.resize(width, height).toBuffer()}])
                .png()
                .toBuffer();

            res.contentType('image/png');
            res.send(combined);
        } catch (e) {
            if (e instanceof StravaError) {
                res.status(404).send('Strava imagery not found');
            } else {
                res.status(500).send('Something went wrong');
            }
            logger.exception(e);
        }
    });

    app.listen(port, () => {
        console.log(`server started on port ${port}`);
    });
}
