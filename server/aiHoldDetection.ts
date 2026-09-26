import OpenAI from 'openai'
import { z } from 'zod'

const MODEL = process.env.OPENAI_VISION_MODEL ?? 'gpt-6-luna'

const aiHoldSchema = z.object({
  center: z.object({
    x: z.number().int().min(0).max(1000),
    y: z.number().int().min(0).max(1000),
  }),
  box: z.object({
    left: z.number().int().min(0).max(1000),
    top: z.number().int().min(0).max(1000),
    right: z.number().int().min(0).max(1000),
    bottom: z.number().int().min(0).max(1000),
  }),
  colour: z.enum([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'white',
    'grey',
    'black',
    'other',
  ]),
  confidence: z.number().int().min(0).max(100),
})

const aiDetectionSchema = z.object({
  holds: z.array(aiHoldSchema).max(180),
})

export type AiHold = {
  center: { x: number; y: number }
  box: { left: number; top: number; right: number; bottom: number }
  colour: z.infer<typeof aiHoldSchema>['colour']
  confidence: number
}

export function getAiDetectionStatus() {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY),
    model: MODEL,
  }
}

export async function detectHoldsWithAI(imageDataUrl: string): Promise<AiHold[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const client = new OpenAI({ apiKey })
  const response = await client.responses.create({
    model: MODEL,
    store: false,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              'Inspect this indoor climbing-wall image and locate every individual climbing hold.',
              'Return one item per physical hold, including holds that are white, grey, black, shadowed, partly occluded, or touching another hold.',
              'Volumes are background support surfaces: do not return the volume itself, but do return every separate hold bolted onto a volume, even when the hold touches it or has a similar colour.',
              'Do not include bolt holes, panel seams, wall texture, people, clothing, mats, signs, large structural wall volumes, or shadows.',
              'Coordinates use a 0 to 1000 grid: x=0 is the left edge, y=0 is the top edge.',
              'For each hold, provide its center and a tight bounding box. Keep touching holds separate.',
              'Use confidence below 55 when the object may not be a climbing hold.',
            ].join(' '),
          },
          {
            type: 'input_image',
            image_url: imageDataUrl,
            detail: 'high',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'climbing_hold_detection',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            holds: {
              type: 'array',
              maxItems: 180,
              items: {
                type: 'object',
                properties: {
                  center: {
                    type: 'object',
                    properties: {
                      x: { type: 'integer', minimum: 0, maximum: 1000 },
                      y: { type: 'integer', minimum: 0, maximum: 1000 },
                    },
                    required: ['x', 'y'],
                    additionalProperties: false,
                  },
                  box: {
                    type: 'object',
                    properties: {
                      left: { type: 'integer', minimum: 0, maximum: 1000 },
                      top: { type: 'integer', minimum: 0, maximum: 1000 },
                      right: { type: 'integer', minimum: 0, maximum: 1000 },
                      bottom: { type: 'integer', minimum: 0, maximum: 1000 },
                    },
                    required: ['left', 'top', 'right', 'bottom'],
                    additionalProperties: false,
                  },
                  colour: {
                    type: 'string',
                    enum: [
                      'red', 'orange', 'yellow', 'green', 'blue', 'purple',
                      'pink', 'white', 'grey', 'black', 'other',
                    ],
                  },
                  confidence: { type: 'integer', minimum: 0, maximum: 100 },
                },
                required: ['center', 'box', 'colour', 'confidence'],
                additionalProperties: false,
              },
            },
          },
          required: ['holds'],
          additionalProperties: false,
        },
      },
    },
  })

  const parsed = aiDetectionSchema.parse(JSON.parse(response.output_text))
  return parsed.holds
    .filter((hold) =>
      hold.confidence >= 50 &&
      hold.box.right > hold.box.left &&
      hold.box.bottom > hold.box.top,
    )
    .map((hold) => ({
      center: { x: hold.center.x / 10, y: hold.center.y / 10 },
      box: {
        left: hold.box.left / 10,
        top: hold.box.top / 10,
        right: hold.box.right / 10,
        bottom: hold.box.bottom / 10,
      },
      colour: hold.colour,
      confidence: hold.confidence,
    }))
}
